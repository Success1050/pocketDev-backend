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

  async spinUpWorkspace(taskId: string, repoUrl: string, portMappings: { containerPort: number; hostPort: number }[] = []) {
    this.logger.log(`[Docker] Spinning up isolated workspace container for task: ${taskId} with repo: ${repoUrl}`);

    // Build port bindings and exposed ports from the mappings
    const ExposedPorts: Record<string, object> = {};
    const PortBindings: Record<string, { HostPort: string }[]> = {};
    for (const mapping of portMappings) {
      const key = `${mapping.containerPort}/tcp`;
      ExposedPorts[key] = {};
      PortBindings[key] = [{ HostPort: String(mapping.hostPort) }];
    }

    const container = await this.docker.createContainer({
      Image: 'pocketdev-base',
      Cmd: ['tail', '-f', '/dev/null'],
      Tty: true,
      name: `pocketdev-workspace-${taskId}-${Date.now()}`,
      WorkingDir: '/workspace',
      ExposedPorts,
      HostConfig: {
        AutoRemove: true,
        Binds: ['pocketdev_npm_cache:/root/.npm'],
        PortBindings,
        ExtraHosts: ['host.docker.internal:host-gateway']
      }
    });

    await container.start();

    // node:20 already has git, curl, bash, and python3. No network installation needed!
    return { containerId: container.id };
  }

  async executeCommand(containerId: string, command: string, timeoutMs: number = 180000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

      let timeoutId: NodeJS.Timeout;
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          this.logger.warn(`[Docker:${containerId}] Command timed out after ${timeoutMs}ms: ${command}`);
          resolve({ stdout: stdout + '\n[TIMEOUT]', stderr: stderr + '\n[TIMEOUT]', exitCode: 124 });
        }, timeoutMs);
      }

      stream.on('end', async () => {
        if (timeoutId) clearTimeout(timeoutId);
        const inspect = await exec.inspect();
        resolve({ stdout, stderr, exitCode: inspect.ExitCode || 0 });
      });
      stream.on('error', (err) => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(err);
      });
    });
  }

  async cloneRepo(containerId: string, repoUrl: string, branchName: string, githubToken?: string, targetDir: string = '.', envContent?: string, isLocal?: boolean) {
    if (isLocal) {
      this.logger.log(`[Docker:${containerId}] Downloading local zip from ${repoUrl} into workspace ${targetDir}`);
      if (targetDir !== '.') {
        await this.executeCommand(containerId, `mkdir -p ${targetDir}`);
      }
      const zipPath = `/tmp/local_upload_${Date.now()}.zip`;
      const dockerRepoUrl = repoUrl.replace('localhost', 'host.docker.internal').replace('127.0.0.1', 'host.docker.internal');
      await this.executeCommand(containerId, `wget -qO ${zipPath} "${dockerRepoUrl}"`);
      // Use Python to extract since unzip might not be installed, or just use python3 -m zipfile
      await this.executeCommand(containerId, `python3 -m zipfile -e ${zipPath} ${targetDir}`);
      
      // If the extracted folder contains exactly one directory and nothing else, move everything up one level.
      await this.executeCommand(containerId, `cd ${targetDir} && if [ $(ls -1A | wc -l) -eq 1 ] && [ -d $(ls -1A) ]; then DIR_NAME=$(ls -1A); mv "$DIR_NAME"/* . 2>/dev/null || true; mv "$DIR_NAME"/.* . 2>/dev/null || true; rmdir "$DIR_NAME"; fi`);

      // Initialize git so we can track the AI's changes and generate diffs!
      await this.executeCommand(containerId, `cd ${targetDir} && git init`);
      await this.executeCommand(containerId, `git config --global user.email "bot@pocketdev.app"`);
      await this.executeCommand(containerId, `git config --global user.name "PocketDev AI"`);
      await this.executeCommand(containerId, `cd ${targetDir} && git add -A && git commit -m "Initial upload"`);

      if (envContent) {
        const base64Env = Buffer.from(envContent).toString('base64');
        await this.executeCommand(containerId, `cd ${targetDir} && echo -n "${base64Env}" | base64 -d > .env`);
      }
      return;
    }

    this.logger.log(`[Docker:${containerId}] Cloning repo ${repoUrl} into workspace ${targetDir}`);

    const authUrl = githubToken ? repoUrl.replace('https://', `https://${githubToken}@`) : repoUrl;

    // Apply git network resilience settings to prevent OpenSSL EOF and curl 56 errors
    await this.executeCommand(containerId, `git config --global http.postBuffer 524288000`);
    await this.executeCommand(containerId, `git config --global http.version HTTP/1.1`);
    await this.executeCommand(containerId, `git config --global http.sslVerify false`);

    let retries = 3;
    let lastError = '';

    if (targetDir !== '.') {
      await this.executeCommand(containerId, `mkdir -p ${targetDir}`);
    }

    while (retries > 0) {
      const result = await this.executeCommand(containerId, `cd ${targetDir} && env GIT_TERMINAL_PROMPT=0 git clone --depth 1 -b ${branchName} ${authUrl} .`);
      if (result.exitCode !== 0) {
        lastError = result.stderr;
        
        // If the branch is not found on remote, clone the default branch and create it locally
        if (lastError.includes('not found') || lastError.includes('empty repository')) {
          this.logger.warn(`[Docker:${containerId}] Remote branch ${branchName} not found or empty repository. Cloning default branch and creating locally...`);
          await this.executeCommand(containerId, `cd ${targetDir} && rm -rf .git * .* 2>/dev/null || true`);
          const fallbackResult = await this.executeCommand(containerId, `cd ${targetDir} && env GIT_TERMINAL_PROMPT=0 git clone --depth 1 ${authUrl} .`);
          
          if (fallbackResult.stderr.includes('empty repository') || fallbackResult.stderr.includes('no commits exist')) {
            await this.executeCommand(containerId, `cd ${targetDir} && env GIT_TERMINAL_PROMPT=0 git init`);
            await this.executeCommand(containerId, `git config --global user.email "bot@pocketdev.app"`);
            await this.executeCommand(containerId, `git config --global user.name "PocketDev AI"`);
            await this.executeCommand(containerId, `cd ${targetDir} && env GIT_TERMINAL_PROMPT=0 git commit --allow-empty -m "Initial commit"`);
            await this.executeCommand(containerId, `cd ${targetDir} && env GIT_TERMINAL_PROMPT=0 git checkout -b ${branchName}`);
            await this.executeCommand(containerId, `cd ${targetDir} && git remote add origin ${authUrl} || git remote set-url origin ${authUrl}`);
            
            if (envContent) {
              const base64Env = Buffer.from(envContent).toString('base64');
              await this.executeCommand(containerId, `cd ${targetDir} && echo -n "${base64Env}" | base64 -d > .env`);
            }
            return; // Success!
          }

          if (fallbackResult.exitCode === 0) {
            await this.executeCommand(containerId, `cd ${targetDir} && env GIT_TERMINAL_PROMPT=0 git checkout -b ${branchName}`);
            if (envContent) {
              const base64Env = Buffer.from(envContent).toString('base64');
              await this.executeCommand(containerId, `cd ${targetDir} && echo -n "${base64Env}" | base64 -d > .env`);
            }
            return; // Success!
          }
          
          lastError = fallbackResult.stderr || 'Unknown fallback clone error';
        }

        this.logger.warn(`[Docker:${containerId}] Clone failed, retries left: ${retries - 1}. Error: ${lastError}`);
        
        // Clean the directory before retrying
        await this.executeCommand(containerId, `cd ${targetDir} && rm -rf .git * .* 2>/dev/null || true`);
        
        retries--;
        if (retries === 0) {
          throw new Error(`Failed to clone: ${lastError}`);
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        if (envContent) {
          const base64Env = Buffer.from(envContent).toString('base64');
          await this.executeCommand(containerId, `cd ${targetDir} && echo -n "${base64Env}" | base64 -d > .env`);
        }
        return result;
      }
    }
  }

  async commitAndPush(containerId: string, branchName: string, message: string, githubToken?: string, repoUrl?: string, targetDir: string = '.') {
    this.logger.log(`[Docker:${containerId}] Committing and pushing changes to ${branchName} in ${targetDir}`);

    await this.executeCommand(containerId, `git config --global user.email "bot@pocketdev.app"`);
    await this.executeCommand(containerId, `git config --global user.name "PocketDev AI"`);

    await this.executeCommand(containerId, `cd ${targetDir} && (env GIT_TERMINAL_PROMPT=0 git checkout -b ${branchName} || env GIT_TERMINAL_PROMPT=0 git checkout ${branchName})`);
    await this.executeCommand(containerId, `cd ${targetDir} && git add .`);
    await this.executeCommand(containerId, `cd ${targetDir} && (git commit -m "${message}" || echo "No changes to commit")`);

    if (repoUrl && githubToken) {
      const authUrl = repoUrl.replace('https://', `https://${githubToken}@`);
      await this.executeCommand(containerId, `cd ${targetDir} && git remote set-url origin ${authUrl}`);
    }

    const pushResult = await this.executeCommand(containerId, `cd ${targetDir} && env GIT_TERMINAL_PROMPT=0 git push origin ${branchName}`);

    if (pushResult.exitCode !== 0) {
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
