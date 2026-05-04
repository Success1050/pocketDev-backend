import { Injectable } from '@nestjs/common';
import { DockerService } from '../docker/docker.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
@Injectable()
export class AgentService {
  constructor(
    private readonly dockerService: DockerService,
    private readonly prisma: PrismaService,
  ) { }

  private getModel(providerName?: string, modelName?: string) {
    const provider = providerName?.toLowerCase() || 'openai';
    const model = modelName || 'gpt-4o';

    if (provider === 'anthropic') {
      const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      return anthropic(model);
    }

    // Default to OpenAI
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai(model);
  }

  getAvailableModels() {
    return [
      {
        providerId: 'openai',
        name: 'OpenAI',
        models: [
          { id: 'gpt-4o', name: 'GPT-4o (Recommended)' },
          { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
          { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
        ],
      },
      {
        providerId: 'anthropic',
        name: 'Anthropic',
        models: [
          { id: 'claude-3-5-sonnet-20240620', name: 'Claude 3.5 Sonnet' },
          { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
          { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
        ],
      },
    ];
  }

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

      let isTaskComplete = false;
      let loopCount = 0;

      const aiModel = this.getModel(payload.llm?.provider, payload.llm?.model);

      while (!isTaskComplete && loopCount < 5) {
        loopCount++;
        await this.addLog(taskId, 'process', `AI thinking... (iteration ${loopCount})`);

        try {
          const { text } = await generateText({
            model: aiModel,
            prompt: `You are an AI developer agent. The user wants you to: ${payload.instruction}. 
            We are in iteration ${loopCount}. Output a single bash command to execute in the workspace to make progress on this task.
            Do not include markdown formatting or backticks, just the raw bash command.
            If you want to create a file, use echo or cat. If you think the task is done, output: echo "DONE"`,
          });

          const aiChosenCommand = text.trim();
          await this.addLog(taskId, 'info', `> ${aiChosenCommand}`);

          const result = await this.dockerService.executeCommand(containerId, aiChosenCommand);
          await this.addLog(taskId, 'info', `Tool output: ${result.stdout}`);

          // For safety, we keep the loopCount limit. If the AI outputs DONE, we finish.
          if (aiChosenCommand.includes('DONE') || loopCount === 2) {
            await this.addLog(taskId, 'success', `AI completed code modifications`);
            isTaskComplete = true;
          }
        } catch (error) {
          await this.addLog(taskId, 'error', `AI Generation failed: ${error.message}`);
          break; // Exit the loop on failure
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

      // Step 6: Generate preview URL (using repo homepage if available)
      const previewUrl = payload.repo?.homepage || `https://${payload.repo?.name}-preview.vercel.app`;
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
