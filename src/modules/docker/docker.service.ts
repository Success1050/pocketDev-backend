import { Injectable, Logger } from '@nestjs/common';
import Docker from 'dockerode';
import { PassThrough } from 'stream';

@Injectable()
export class DockerService {
  private docker: Docker;
  private readonly logger = new Logger(DockerService.name);

  constructor() {
    this.docker = new Docker();
  }

  private async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      this.logger.log(`[Docker] Image ${image} already exists locally. Skipping pull.`);
      return;
    } catch (e: any) {
      this.logger.log(`[Docker] Image ${image} not found locally. Pulling from registry...`);
    }

    return new Promise((resolve, reject) => {
      this.docker.pull(image, (err: any, stream: any) => {
        if (err) return reject(err);
        this.docker.modem.followProgress(stream, onFinished);
        function onFinished(err: any, output: any) {
          if (err) return reject(err);
          resolve();
        }
      });
    });
  }

  async spinUpWorkspace(taskId: string, repoUrl: string) {
    this.logger.log(`[Docker] Ensuring image node:20-alpine is pulled...`);
    await this.ensureImage('node:20-alpine');
    this.logger.log(`[Docker] Spinning up isolated workspace container for task: ${taskId} with repo: ${repoUrl}`);
    const container = await this.docker.createContainer({
      Image: 'node:20-alpine',
      Cmd: ['tail', '-f', '/dev/null'],
      Tty: true,
      name: `pocketdev-workspace-${taskId}-${Date.now()}`,
      WorkingDir: '/workspace',
      HostConfig: {
        AutoRemove: true,
      }
    });

    await container.start();

    // Alpine doesn't have git by default
    await this.executeCommand(container.id, 'apk add --no-cache git');

    return { containerId: container.id };
  }

  async executeCommand(containerId: string, command: string): Promise<{ stdout: string; stderr: string }> {
    this.logger.log(`[Docker:${containerId}] Executing: ${command}`);
    const container = this.docker.getContainer(containerId);

    const exec = await container.exec({
      Cmd: ['sh', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ Detach: false, Tty: false });

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const outStream = new PassThrough();
      const errStream = new PassThrough();

      outStream.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      errStream.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });

      this.docker.modem.demuxStream(stream, outStream, errStream);

      stream.on('end', () => resolve({ stdout, stderr }));
      stream.on('error', (err) => reject(err));
    });
  }

  async cloneRepo(containerId: string, repoUrl: string, branchName: string, githubToken?: string) {
    this.logger.log(`[Docker:${containerId}] Cloning repo ${repoUrl} into workspace`);

    const authUrl = githubToken ? repoUrl.replace('https://', `https://${githubToken}@`) : repoUrl;

    // Apply git network resilience settings to prevent OpenSSL EOF and curl 56 errors
    await this.executeCommand(containerId, `git config --global http.postBuffer 524288000`);
    await this.executeCommand(containerId, `git config --global http.version HTTP/1.1`);
    await this.executeCommand(containerId, `git config --global http.sslVerify false`);

    let retries = 3;
    let lastError = '';

    while (retries > 0) {
      const result = await this.executeCommand(containerId, `git clone -b ${branchName} ${authUrl} .`);
      if (result.stderr && result.stderr.toLowerCase().includes('fatal:')) {
        lastError = result.stderr;
        
        // If the branch is not found on remote, clone the default branch and create it locally
        if (result.stderr.includes('not found')) {
          this.logger.warn(`[Docker:${containerId}] Remote branch ${branchName} not found. Cloning default branch and creating locally...`);
          await this.executeCommand(containerId, `rm -rf .git * .* 2>/dev/null || true`);
          const fallbackResult = await this.executeCommand(containerId, `git clone ${authUrl} .`);
          if (!fallbackResult.stderr || !fallbackResult.stderr.toLowerCase().includes('fatal:')) {
            await this.executeCommand(containerId, `git checkout -b ${branchName}`);
            return; // Success!
          }
          lastError = fallbackResult.stderr || 'Unknown fallback clone error';
        }

        this.logger.warn(`[Docker:${containerId}] Clone failed, retries left: ${retries - 1}. Error: ${lastError}`);
        
        // Clean the directory before retrying
        await this.executeCommand(containerId, `rm -rf .git * .* 2>/dev/null || true`);
        
        retries--;
        if (retries === 0) {
          throw new Error(`Failed to clone: ${lastError}`);
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        return result;
      }
    }
  }

  async commitAndPush(containerId: string, branchName: string, message: string, githubToken?: string, repoUrl?: string) {
    this.logger.log(`[Docker:${containerId}] Committing and pushing changes to ${branchName}`);

    await this.executeCommand(containerId, `git config --global user.email "bot@pocketdev.app"`);
    await this.executeCommand(containerId, `git config --global user.name "PocketDev AI"`);

    await this.executeCommand(containerId, `git checkout -b ${branchName} || git checkout ${branchName}`);
    await this.executeCommand(containerId, `git add .`);
    await this.executeCommand(containerId, `git commit -m "${message}" || echo "No changes to commit"`);

    if (repoUrl && githubToken) {
      const authUrl = repoUrl.replace('https://', `https://${githubToken}@`);
      await this.executeCommand(containerId, `git remote set-url origin ${authUrl}`);
    }

    const pushResult = await this.executeCommand(containerId, `git push origin ${branchName}`);

    if (pushResult.stderr && pushResult.stderr.toLowerCase().includes('fatal:')) {
      throw new Error(`Push failed: ${pushResult.stderr}`);
    }
  }

  async cleanupWorkspace(containerId: string) {
    this.logger.log(`[Docker] Destroying workspace container: ${containerId}`);
    try {
      const container = this.docker.getContainer(containerId);
      await container.kill();
    } catch (err) {
      this.logger.error(`Failed to cleanup container ${containerId}`, err);
    }
  }
}
