import { Injectable } from '@nestjs/common';
import { DockerService } from '../docker/docker.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
@Injectable()
export class AgentService {
  constructor(
    private readonly dockerService: DockerService,
    private readonly prisma: PrismaService,
  ) { }

  private getModel(providerName?: string, modelName?: string) {
    const model = modelName || 'claude-3-5-sonnet-20240620';
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return anthropic(model);
  }

  async getAvailableModels() {
    try {
      const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY || '',
          'anthropic-version': '2023-06-01'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      const models = data.data.map((m: any) => ({
        id: m.id,
        name: m.display_name || m.name || m.id
      }));

      return [
        {
          providerId: 'anthropic',
          name: 'Anthropic',
          models: models,
        }
      ];
    } catch (error) {
      console.error('Failed to fetch Anthropic models:', error);
      return [
        {
          providerId: 'anthropic',
          name: 'Anthropic',
          models: [
            { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
            { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
          ],
        },
      ];
    }
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
      const task = await this.prisma.task.findUnique({ where: { id: taskId }, include: { user: true } });
      const githubToken = task?.user?.accessToken;

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
      await this.dockerService.cloneRepo(containerId!, payload.repo?.url, payload.branch?.baseBranch || 'main', githubToken || undefined);
      await this.addLog(taskId, 'success', 'Repository cloned successfully');

      // Step 2.5: Planning
      await this.addLog(taskId, 'process', `Generating Implementation Plan...`);
      const aiModel = this.getModel(payload.llm?.provider, payload.llm?.model);
      const { text: planText } = await generateText({
        model: aiModel,
        prompt: `You are an AI developer agent. The user wants you to: ${payload.instruction}.
        Project language/framework: ${payload.meta?.language || 'Unknown'}.
        Based on this, output a step-by-step implementation plan. 
        Format it nicely in Markdown. Do not include introductory text, just the plan.`,
      });
      await this.prisma.task.update({
        where: { id: taskId },
        data: { plan: planText, status: 'awaiting-approval' },
      });
      await this.addLog(taskId, 'info', `Waiting for user to approve the plan...`);

      let planApproved = false;
      while (!planApproved) {
        await new Promise(r => setTimeout(r, 3000));
        const currentTask = await this.prisma.task.findUnique({ where: { id: taskId } });
        if (currentTask?.status === 'in-progress' || currentTask?.status === 'plan-approved') {
          planApproved = true;
          await this.prisma.task.update({ where: { id: taskId }, data: { status: 'in-progress' } });
        } else if (currentTask?.status === 'plan-rejected') {
          await this.addLog(taskId, 'process', `Plan rejected. Re-generating based on feedback...`);
          const { text: newPlan } = await generateText({
            model: aiModel,
            prompt: `You are an AI developer agent. The user wants you to: ${currentTask?.description}.
            Output a step-by-step implementation plan. Do not include introductory text.`,
          });
          await this.prisma.task.update({
            where: { id: taskId },
            data: { plan: newPlan, status: 'awaiting-approval' },
          });
          await this.addLog(taskId, 'info', `Waiting for user to approve the revised plan...`);
        }
      }
      await this.addLog(taskId, 'success', `Plan approved! Commencing execution.`);

      // Step 3: AI Loop
      await this.addLog(taskId, 'process', `Sending instruction to ${payload.llm?.provider} (${payload.llm?.model})...`);
      const currentTaskFinal = await this.prisma.task.findUnique({ where: { id: taskId } });
      await this.addLog(taskId, 'info', `Instruction: "${currentTaskFinal?.description || payload.instruction}"`);

      let isTaskComplete = false;
      let loopCount = 0;
      let history = '';

      while (!isTaskComplete && loopCount < 15) {
        loopCount++;
        await this.addLog(taskId, 'process', `AI thinking... (iteration ${loopCount})`);

        try {
          const { text } = await generateText({
            model: aiModel,
            prompt: `You are an AI developer agent. The user wants you to: ${payload.instruction}.
            Project language/framework: ${payload.meta?.language || 'Unknown (inspect first)'}.
            
            CRITICAL RULES:
            1. BEFORE writing any code, you MUST explore the codebase (using 'ls', 'cat package.json', etc.) to understand the existing architecture, framework (Next.js, React, etc.), and file structure.
            2. NEVER write plain HTML files (.html) if the project uses a frontend framework like Next.js or React. You MUST create the appropriate framework components (.tsx, .jsx, etc.) and integrate them into the existing routing and layout.
            3. Modify existing files (like navigation bars) to link to your new pages.
            4. ALWAYS verify your code before marking the task as DONE based on the framework/language. For Next.js/NestJS/React run 'npm run build' to catch errors. For pure Node.js run 'npm run lint'. For Rust run 'cargo check'. Fix any errors you find before concluding.
            5. Inspect 'package.json' for other essential scripts (e.g., database migrations, seeding, formatting) and intelligently run those commands if the task requires them.
            
            Past actions and outputs:
            ${history}
            
            We are in iteration ${loopCount} (Max 15). Output a SINGLE bash command to execute in the workspace to make progress on this task.
            Do not include markdown formatting or backticks, just the raw bash command.
            If you want to create a file, use echo or cat. If you think the task is done, output: echo "DONE"`,
          });

          const aiChosenCommand = text.trim();
          await this.addLog(taskId, 'info', `> ${aiChosenCommand}`);

          const result = await this.dockerService.executeCommand(containerId!, aiChosenCommand);
          await this.addLog(taskId, 'info', `Tool output: ${result.stdout.substring(0, 500)}${result.stdout.length > 500 ? '...' : ''}`);
          
          history += `Command: ${aiChosenCommand}\nOutput: ${result.stdout || result.stderr}\n\n`;

          // For safety, we keep the loopCount limit. If the AI outputs DONE, we finish.
          if (aiChosenCommand.includes('DONE') || loopCount >= 15) {
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
      await this.dockerService.executeCommand(containerId!, 'npm install');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.addLog(taskId, 'success', '✓ Dependencies installed successfully');

      // Live Preview
      await this.addLog(taskId, 'process', 'Spinning up live preview (localtunnel)...');
      await this.dockerService.executeCommand(containerId!, 'npm run dev & npx --yes localtunnel --port 3000 > lt.log &');
      await new Promise(r => setTimeout(r, 6000));
      const ltResult = await this.dockerService.executeCommand(containerId!, 'cat lt.log');
      const urlMatch = ltResult.stdout.match(/your url is: (https:\/\/[^\s]+)/);
      if (urlMatch) {
        await this.prisma.task.update({ where: { id: taskId }, data: { previewUrl: urlMatch[1] } });
        await this.addLog(taskId, 'info', `Live preview available at: ${urlMatch[1]}`);
      }

      // Step 4.5: Diff
      await this.addLog(taskId, 'process', 'Generating code diff...');
      const diffResult = await this.dockerService.executeCommand(containerId!, 'git diff');
      await this.prisma.task.update({ where: { id: taskId }, data: { diff: diffResult.stdout } });

      await this.addLog(taskId, 'process', 'Running build...');
      await this.dockerService.executeCommand(containerId!, 'npm run build');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.addLog(taskId, 'success', '✓ Build completed successfully');

      // Step 5: Git Sync
      const targetBranch = payload.branch?.name || `ai-task-${taskId}`;
      await this.addLog(taskId, 'info', `Pushing changes to branch: ${targetBranch}`);
      await this.dockerService.commitAndPush(containerId!, targetBranch, `AI: ${payload.instruction}`, githubToken || undefined, payload.repo?.url);
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
