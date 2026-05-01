import { Injectable } from '@nestjs/common';
import { DockerService } from '../docker/docker.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class AgentService {
  constructor(
    private readonly dockerService: DockerService,
    private readonly prisma: PrismaService,
  ) { }

  async processTask(taskId: string, payload: any) {
    let containerId: string | null = null;
    try {
      console.log(`\n=== Starting AI Task Execution: ${taskId} ===`);
      console.log(`LLM Model Selected: ${payload.llm?.provider} - ${payload.llm?.model}`);
      console.log(`Project: ${payload.repo?.name} | Target Branch: ${payload.branch?.name}`);
      console.log(`Instruction: ${payload.instruction}\n`);

      // Update status
      await this.prisma.task.update({ where: { id: taskId }, data: { status: 'in-progress' } });

      // Step 1: Spin up Workspace
      const workspace = await this.dockerService.spinUpWorkspace(taskId, payload.repo?.url);
      containerId = workspace.containerId;

      // Step 2: Clone Repo
      await this.dockerService.cloneRepo(containerId, payload.repo?.url, payload.branch?.baseBranch || 'main');

      // Step 3: Run AI Loop (Dynamic Tool Calling driven by User Instruction)
      console.log(`[Agent] Sending instruction to ${payload.llm?.provider} (${payload.llm?.model})...`);

      const systemPrompt = `
        You are an autonomous AI coding agent. 
        Your task is to fulfill the user's instruction: "${payload.instruction}"
        You have access to the following tools inside the Docker workspace:
        - readFile(path)
        - writeFile(path, content)
        - runCommand(command)
        - searchCode(query)
        - commitAndPush(branchName, message) // Use this only if the user explicitly instructs you to push
        Please execute the steps necessary to complete the task.
      `;

      console.log(`[Agent] Initializing AI Context with System Prompt:\n${systemPrompt}`);

      // Simulated AI Loop analyzing the instruction and deciding which tools to call
      let isTaskComplete = false;
      let loopCount = 0;

      while (!isTaskComplete && loopCount < 5) { // Prevent infinite loops
        loopCount++;
        console.log(`\n[AI Loop Iteration ${loopCount}] AI is thinking...`);

        // In a real implementation, you would call the OpenAI/Anthropic API here
        // const response = await llm.chat({ messages: [{ role: 'system', content: systemPrompt }] });

        // Simulating the AI deciding to run a command based on the instruction
        const aiChosenCommand = `echo "Executing AI logic for: ${payload.instruction}" > ai_output.txt`;
        console.log(`[AI Decided] Calling Tool: runCommand("${aiChosenCommand}")`);

        const result = await this.dockerService.executeCommand(containerId, aiChosenCommand);
        console.log(`[Tool Output] ${result.stdout}`);

        // If the AI determines the user's instruction is fulfilled, it breaks the loop
        if (loopCount === 2) {
          if (payload.instruction.toLowerCase().includes('push')) {
            const targetBranch = payload.branch?.name || `ai-task-${taskId}`;
            console.log(`[AI Decided] Calling Tool: commitAndPush("${targetBranch}")`);
            await this.dockerService.commitAndPush(containerId, targetBranch, `AI: ${payload.instruction}`);
          } else {
            console.log(`[AI Decided] User did not instruct to push. Changes will not be synced to remote.`);
          }
          console.log(`[AI Decided] Task "${payload.instruction}" is complete.`);
          isTaskComplete = true;
        }
      }

      // Step 4: Validate (Build/Test)
      console.log(`[Agent] Validating changes (running npm install & build)...`);
      await this.dockerService.executeCommand(containerId, `npm install`);
      await this.dockerService.executeCommand(containerId, `npm run build`);

      // Note: Git Sync (Commit & Push) is now handled dynamically by the AI loop above
      // if the user's instruction required it.

      // Finish
      await this.prisma.task.update({ where: { id: taskId }, data: { status: 'completed', logs: 'Build successful' } });
      console.log(`=== Task Execution Completed: ${taskId} ===\n`);

    } catch (error) {
      console.error(`[Agent] Task failed:`, error);
      await this.prisma.task.update({ where: { id: taskId }, data: { status: 'failed', logs: error.message } });
    } finally {
      // Step 6: Cleanup Workspace
      if (containerId) {
        await this.dockerService.cleanupWorkspace(containerId);
      }
    }
  }
}
