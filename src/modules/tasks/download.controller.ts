import { Controller, Get, Param, Res, BadRequestException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { DockerService } from '../docker/docker.service';
import { AgentService } from '../agent/agent.service';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

@Controller('tasks')
export class DownloadController {
  private readonly logger = new Logger(DownloadController.name);

  constructor(
    private readonly dockerService: DockerService,
    private readonly agentService: AgentService,
  ) {}

  @Get(':id/download')
  async downloadTaskWorkspace(@Param('id') id: string, @Res() res: Response) {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) {
      throw new BadRequestException('Task not found');
    }

    const containerId = this.agentService.getActiveContainerId(id);
    if (!containerId) {
      throw new BadRequestException('Workspace container is no longer active. Cannot download.');
    }

    const zipPath = `/tmp/workspace_${id}.zip`;
    
    // Create ZIP inside the container
    // Excluding .git, node_modules, .env, dev.log to save space and keep it clean
    await this.dockerService.executeCommand(containerId, `cd /workspace && zip -r ${zipPath} . -x "*.git*" -x "*node_modules*" -x "*.env*" -x "dev.log"`);
    
    // Copy ZIP from container to host using docker cp
    const hostZipPath = path.join(process.cwd(), `tmp_${id}.zip`);
    await execAsync(`docker cp ${containerId}:${zipPath} ${hostZipPath}`);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="pocketdev_project_${id}.zip"`,
    });
    
    const fileStream = fs.createReadStream(hostZipPath);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      // Cleanup after streaming
      fs.unlinkSync(hostZipPath);
    });
  }
}
