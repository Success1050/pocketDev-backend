import { Controller, Post, Param, Body, BadRequestException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DockerService } from '../docker/docker.service';
import { AgentService } from '../agent/agent.service';
import axios from 'axios';

const prisma = new PrismaClient();

@Controller('tasks')
export class PublishGithubController {
  private readonly logger = new Logger(PublishGithubController.name);

  constructor(
    private readonly dockerService: DockerService,
    private readonly agentService: AgentService,
  ) {}

  @Post(':id/publish-github')
  async publishToGithub(@Param('id') id: string, @Body() body: { repoName: string; isPrivate: boolean }) {
    const task = await prisma.task.findUnique({ 
      where: { id },
      include: { user: true }
    });
    
    if (!task) {
      throw new BadRequestException('Task not found');
    }

    if (!task.user.accessToken) {
      throw new BadRequestException('User does not have a GitHub access token connected');
    }

    const containerId = this.agentService.getActiveContainerId(id);
    if (!containerId) {
      throw new BadRequestException('Workspace container is no longer active. Cannot publish.');
    }

    try {
      // 1. Create GitHub Repo via API
      this.logger.log(`Creating GitHub repo ${body.repoName} for user ${task.user.username}`);
      const githubRes = await axios.post(
        'https://api.github.com/user/repos',
        {
          name: body.repoName,
          private: body.isPrivate,
          description: `Created by PocketDev`
        },
        {
          headers: {
            Authorization: `token ${task.user.accessToken}`,
            Accept: 'application/vnd.github.v3+json'
          }
        }
      );

      const cloneUrl = githubRes.data.clone_url;
      const owner = githubRes.data.owner.login;
      
      const authUrl = cloneUrl.replace('https://', `https://${task.user.accessToken}@`);

      // 2. Run Git commands in the container
      const targetDir = task.repoName || '.';
      const targetMergeBranch = task.branchName || 'main';

      await this.agentService.addLog(id, 'process', `Publishing local project to GitHub repository ${owner}/${body.repoName}...`);

      // Add all changes (respects .gitignore) and push to the new remote
      await this.dockerService.executeCommand(containerId, `cd ${targetDir} && git add -A`);
      await this.dockerService.executeCommand(containerId, `cd ${targetDir} && git commit -m "Publish from PocketDev"`);
      await this.dockerService.executeCommand(containerId, `cd ${targetDir} && git remote add origin ${authUrl} || git remote set-url origin ${authUrl}`);
      await this.dockerService.executeCommand(containerId, `cd ${targetDir} && git branch -M ${targetMergeBranch}`);
      await this.dockerService.executeCommand(containerId, `cd ${targetDir} && env GIT_TERMINAL_PROMPT=0 git push -u origin ${targetMergeBranch}`);

      // 3. Update the task to reflect the new GitHub repo info, so it's no longer considered "local"
      await prisma.task.update({
        where: { id },
        data: {
          isLocal: false,
          repoUrl: cloneUrl,
          repoName: body.repoName,
          repoOwner: owner,
          status: 'completed'
        }
      });

      // Also clean up the workspace
      await this.agentService.addLog(id, 'success', `Successfully published to GitHub: ${owner}/${body.repoName}`);
      this.agentService.getActiveContainers().delete(id);
      await this.dockerService.cleanupWorkspace(containerId);

      return { success: true, repoUrl: cloneUrl, owner, name: body.repoName };

    } catch (error: any) {
      this.logger.error(`Failed to publish to GitHub: ${error.response?.data?.message || error.message}`);
      throw new BadRequestException(`Failed to publish to GitHub: ${error.response?.data?.message || error.message}`);
    }
  }
}
