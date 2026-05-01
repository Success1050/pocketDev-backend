import { Injectable } from '@nestjs/common';
import { DockerService } from '../docker/docker.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class AgentService {
  constructor(
    private readonly dockerService: DockerService,
    private readonly prisma: PrismaService,
  ) { }

  /**
   * Append a structured log entry to the TaskLog table.
   */
  private async addLog(taskId: string, type: string, message: string) {
    await this.prisma.taskLog.create({
      data: { taskId, type, message },
    });
    console.log(`[TaskLog:${type}] ${message}`);
  }

  async processTask(taskId: string, payload: any) {
    let containerId: string | null = null;
    try {
      await this.addLog(taskId, 'info', `Task started — ${payload.llm?.provider} (${payload.llm?.model})`);

      // Update status
      await this.prisma.task.update({ where: { id: taskId }, data: { status: 'in-progress' } });
      await this.addLog(taskId, 'process', 'Status updated to in-progress');

      // Step 1: Spin up Workspace
      await this.addLog(taskId, 'info', `Spinning up isolated Docker workspace...`);
      const workspace = await this.dockerService.spinUpWorkspace(taskId, payload.repo?.url);
      containerId = workspace.containerId;
      await this.addLog(taskId, 'success', `Workspace ready — container: ${containerId}`);

      // Step 2: Clone Repo
      await this.addLog(taskId, 'info', `Cloning repository: ${payload.repo?.name} (branch: ${payload.branch?.baseBranch || 'main'})`);
      await this.dockerService.cloneRepo(containerId, payload.repo?.url, payload.branch?.baseBranch || 'main');
      await this.addLog(taskId, 'success', 'Repository cloned successfully');

      // Step 3: AI Loop
      await this.addLog(taskId, 'process', `Sending instruction to ${payload.llm?.provider} (${payload.llm?.model})...`);
      await this.addLog(taskId, 'info', `Instruction: "${payload.instruction}"`);

      // Simulated AI Loop
      let isTaskComplete = false;
      let loopCount = 0;

      while (!isTaskComplete && loopCount < 5) {
        loopCount++;
        await this.addLog(taskId, 'process', `AI thinking... (iteration ${loopCount})`);

        // Simulate a delay for realistic feel
        await new Promise(resolve => setTimeout(resolve, 1500));

        const aiChosenCommand = `echo "Executing AI logic for: ${payload.instruction}" > ai_output.txt`;
        await this.addLog(taskId, 'info', `> ${aiChosenCommand}`);

        const result = await this.dockerService.executeCommand(containerId, aiChosenCommand);
        await this.addLog(taskId, 'info', `Tool output: ${result.stdout}`);

        if (loopCount === 2) {
          await this.addLog(taskId, 'success', `AI completed code modifications`);
          isTaskComplete = true;
        }
      }

      // Step 4: Validate
      await this.addLog(taskId, 'process', 'Validating changes — running npm install...');
      await this.dockerService.executeCommand(containerId, 'npm install');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.addLog(taskId, 'success', '✓ Dependencies installed successfully');

      await this.addLog(taskId, 'process', 'Running build...');
      await this.dockerService.executeCommand(containerId, 'npm run build');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.addLog(taskId, 'success', '✓ Build completed successfully');

      // Step 5: Git Sync
      const targetBranch = payload.branch?.name || `ai-task-${taskId}`;
      await this.addLog(taskId, 'info', `Pushing changes to branch: ${targetBranch}`);
      await this.dockerService.commitAndPush(containerId, targetBranch, `AI: ${payload.instruction}`);
      await this.addLog(taskId, 'success', `✓ Changes pushed to ${targetBranch}`);

      // Step 6: Generate preview URL (simulated)
      const previewUrl = `https://${payload.repo?.name}-preview.vercel.app`;
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'completed', logs: 'Build successful', previewUrl },
      });
      await this.addLog(taskId, 'success', `🎉 Task completed! Preview: ${previewUrl}`);

    } catch (error) {
      console.error(`[Agent] Task failed:`, error);
      await this.addLog(taskId, 'error', `Task failed: ${error.message}`);
      await this.prisma.task.update({ where: { id: taskId }, data: { status: 'failed', logs: error.message } });
    } finally {
      if (containerId) {
        await this.addLog(taskId, 'info', 'Cleaning up workspace...');
        await this.dockerService.cleanupWorkspace(containerId);
        await this.addLog(taskId, 'info', 'Workspace destroyed');
      }
    }
  }
}
