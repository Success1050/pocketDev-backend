import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DockerService } from '../docker/docker.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { generateText, streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { TasksGateway } from '../tasks/tasks.gateway';
import { UsageService, UserTier } from '../usage/usage.service';

@Injectable()
export class AgentService {
  private activeContainers: Map<string, string> = new Map();

  constructor(
    private readonly dockerService: DockerService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly tasksGateway: TasksGateway,
    private readonly usageService: UsageService,
  ) { }

  private getModel(providerName?: string, modelName?: string) {
    const rawModel = modelName || 'claude-haiku-4-5-20251001';
    
    // Robust mapping for Anthropic API model identifiers & aliases
    const MODEL_MAP: Record<string, string> = {
      'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',
      'claude-haiku-4-5': 'claude-haiku-4-5',
      'claude-sonnet-5': 'claude-sonnet-5',
      'claude-opus-5': 'claude-opus-5',
      'claude-fable-5': 'claude-fable-5',
      // Legacy / fallback mappings
      'claude-haiku-4-5-20250414': 'claude-haiku-4-5-20251001',
      'claude-sonnet-4-5-20250929': 'claude-sonnet-5',
      'claude-sonnet-4-5-20250514': 'claude-sonnet-5',
      'claude-opus-4-6': 'claude-opus-5',
      'claude-opus-4-6-20250616': 'claude-opus-5',
      'claude-opus-4-5-20251101': 'claude-opus-5',
      'claude-opus-4-1-20250520': 'claude-opus-5',
    };

    const resolvedModel = MODEL_MAP[rawModel] || rawModel;
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY')?.trim();
    const anthropic = createAnthropic({ apiKey });
    return anthropic(resolvedModel);
  }

  getActiveContainers() {
    return this.activeContainers;
  }

  getActiveContainerId(taskId: string) {
    return this.activeContainers.get(taskId);
  }

  async getAvailableModels(userTier: UserTier = 'free') {
    const MODEL_WHITELIST = [
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', tier: 'free' },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', tier: 'premium' },
      { id: 'claude-opus-5', name: 'Claude Opus 5', tier: 'pro' },
      { id: 'claude-fable-5', name: 'Claude Fable 5', tier: 'pro' },
    ];

    let apiModels: any[] = [];
    try {
      const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': this.configService.get<string>('ANTHROPIC_API_KEY') || '',
          'anthropic-version': '2023-06-01'
        }
      });
      if (response.ok) {
        const data = await response.json();
        apiModels = data.data;
      }
    } catch (error) {
      console.error('Failed to fetch Anthropic models:', error);
    }

    const models = MODEL_WHITELIST.map(wlModel => {
      // Check if API returned it, otherwise use our own names
      const apiModel = apiModels.find(m => m.id === wlModel.id);
      
      const locked = !this.usageService.isModelAllowedForTier(wlModel.id, userTier);
      
      return {
        id: wlModel.id,
        name: wlModel.name, // always use our display name or apiModel name if preferred
        locked,
        requiredTier: wlModel.tier
      };
    });

    return [
      {
        providerId: 'anthropic',
        name: 'Anthropic',
        models: models,
      }
    ];
  }

  /**
   * Append a structured log entry to the TaskLog table.
   */
  async addLog(taskId: string, type: 'info' | 'error' | 'success' | 'warning' | 'process', message: string) {
    const log = await this.prisma.taskLog.create({
      data: { taskId, type, message },
    });
    this.tasksGateway.emitLogAdded(taskId, log);
    console.log(`[TaskLog:${type}] ${message}`);
  }

  /**
   * Update a task in database and immediately emit a taskUpdated socket event.
   */
  async updateTaskAndEmit(taskId: string, data: any) {
    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data,
    });
    this.tasksGateway.emitTaskUpdated(taskId, updated);
    return updated;
  }

  /**
   * Detect if the user's instruction is preview-only (no code changes expected).
   */
  private isPreviewOnly(instruction: string): boolean {
    const lower = instruction.toLowerCase();
    const previewKeywords = [
      'just run', 'live preview', 'run the preview', 'run preview',
      'don\'t change', 'dont change', 'no changes', 'don\'t do any',
      'dont do any', 'run locally', 'run dev', 'see the web app',
      'don\'t make any', 'dont make any', 'preview only', 'just preview',
      'don\'t do any job', 'dont do any job', 'just start', 'just launch',
      'run the app', 'start the app', 'boot up', 'spin up',
      'run the server', 'start the server', 'just the preview',
    ];
    return previewKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Dynamically detect project setup strategy using an LLM.
   */
  private async getProjectSetupStrategy(containerId: string, targetDir: string, port: number) {
    try {
      const lsRes = await this.dockerService.executeCommand(containerId, `cd ${targetDir} && ls -laR --max-depth=2`);
      let files = lsRes.stdout;
      if (files.length > 2000) files = files.substring(0, 2000);
      
      let packageJson = '';
      const pkgCheck = await this.dockerService.executeCommand(containerId, `cd ${targetDir} && test -f package.json && cat package.json || echo ""`);
      if (pkgCheck.stdout && pkgCheck.stdout.length > 10) {
        packageJson = pkgCheck.stdout.substring(0, 1000);
      }

      const { text } = await generateText({
        model: this.getModel('anthropic', 'claude-3-5-sonnet-20240620'), // Fast/Smart model
        prompt: `You are analyzing a codebase to determine how to run it.
        File tree (max depth 2):
        ${files}
        
        Package.json (if any):
        ${packageJson}
        
        Output a valid JSON object with exactly three keys:
        - "installCommand": The bash command to install dependencies (e.g. "npm install", "cargo build", "composer install", "pip install -r requirements.txt", or "" if none needed).
        - "devCommand": The bash command to start the local dev server ON PORT ${port} (e.g. "npm run dev -- --port ${port} --host 0.0.0.0", "php -S 0.0.0.0:${port}", "cargo run", "python3 -m http.server ${port} --bind 0.0.0.0").
        - "projectType": A broad categorization (e.g. "node", "python", "php", "static", "rust", "unknown").
        
        Output strictly ONLY the JSON object. Do not wrap in markdown block.`,
      });

      try {
        const parsed = JSON.parse(text.trim());
        return {
          installCommand: parsed.installCommand || '',
          devCommand: parsed.devCommand || `python3 -m http.server ${port} --bind 0.0.0.0`,
          projectType: parsed.projectType || 'unknown'
        };
      } catch (e) {
        console.warn(`Failed to parse LLM strategy JSON: ${text}`);
      }
    } catch (e) {
      console.error(`Failed to get dynamic strategy: ${e.message}`);
    }
    
    // Fallback
    return {
      installCommand: 'npm install',
      devCommand: 'npm run dev',
      projectType: 'node'
    };
  };

  async processTask(taskId: string, payload: any) {
    let containerId: string | null = null;
    let taskSuccess = false;
    try {
      const task = await this.prisma.task.findUnique({ where: { id: taskId }, include: { user: true } });
      
      if (!task) {
        console.error(`[Agent] Task ${taskId} not found.`);
        return;
      }

      // Prevent duplicate or automatic restart of running/cancelled tasks
      if (task.status === 'cancelled' || task.status === 'in-progress' || task.status === 'completed') {
        console.log(`[Agent] Task ${taskId} is already status '${task.status}'. Aborting duplicate execution.`);
        return;
      }

      const githubToken = task?.user?.accessToken;

      await this.addLog(taskId, 'info', `Task started — ${payload.llm?.provider} (${payload.llm?.model})`);

      // Update status
      const updatedTask = await this.prisma.task.update({ where: { id: taskId }, data: { status: 'in-progress' } });
      this.tasksGateway.emitTaskUpdated(taskId, updatedTask);
      await this.addLog(taskId, 'process', 'Status updated to in-progress');

      // Step 1: Spin up Workspace
      await this.addLog(taskId, 'info', `Spinning up isolated Docker workspace...`);
      
      const hasSecondaryRepo = !!payload.secondaryRepo?.url;
      const primaryTargetDir = hasSecondaryRepo ? payload.repo?.name || 'primary-repo' : '.';
      
      // Assign random host ports for preview (9100-9999 range to avoid conflicts)
      const primaryHostPort = 9100 + Math.floor(Math.random() * 900);
      const secondaryHostPort = primaryHostPort + 1;
      const portMappings = [
        { containerPort: 3000, hostPort: primaryHostPort },
      ];
      if (hasSecondaryRepo) {
        portMappings.push({ containerPort: 4000, hostPort: secondaryHostPort });
      }
      
      const workspace = await this.dockerService.spinUpWorkspace(taskId, payload.repo?.url, portMappings);
      containerId = workspace.containerId;
      this.activeContainers.set(taskId, containerId);
      await this.addLog(taskId, 'success', `Workspace ready — container: ${containerId}`);

      // Step 2: Clone Repo
      
      await this.addLog(taskId, 'info', `Cloning repositories...`);
      // Fetch Environment Variables
      let primaryEnvContent = '';
      if (payload.repo?.owner && payload.repo?.name) {
        const primaryEnv = await this.prisma.projectEnvironment.findUnique({
          where: { userId_repoOwner_repoName: { userId: task.userId, repoOwner: payload.repo.owner, repoName: payload.repo.name } }
        });
        if (primaryEnv) primaryEnvContent = primaryEnv.envContent;
      }

      let secondaryEnvContent = '';
      if (payload.secondaryRepo?.owner && payload.secondaryRepo?.name) {
        const secondaryEnv = await this.prisma.projectEnvironment.findUnique({
          where: { userId_repoOwner_repoName: { userId: task.userId, repoOwner: payload.secondaryRepo.owner, repoName: payload.secondaryRepo.name } }
        });
        if (secondaryEnv) secondaryEnvContent = secondaryEnv.envContent;
      }

      const clonePromises = [
        this.dockerService.cloneRepo(containerId!, payload.repo?.url, payload.branch?.baseBranch || 'main', githubToken || undefined, primaryTargetDir, primaryEnvContent, task.isLocal)
      ];
      
      if (hasSecondaryRepo) {
        const secondaryTargetDir = payload.secondaryRepo?.name || 'secondary-repo';
        clonePromises.push(
          this.dockerService.cloneRepo(containerId!, payload.secondaryRepo?.url, payload.secondaryBranch?.baseBranch || 'main', githubToken || undefined, secondaryTargetDir, secondaryEnvContent, task.isLocal)
        );
      }

      await Promise.all(clonePromises);
      await this.addLog(taskId, 'success', 'Repository(ies) cloned successfully');
      
      // Dynamically detect project setup strategy via LLM
      const primaryStrategy = await this.getProjectSetupStrategy(containerId!, primaryTargetDir, 3000);
      await this.addLog(taskId, 'info', `Primary setup strategy determined via AI.`);

      let attachmentsContext = '';
      if (payload.attachments && payload.attachments.length > 0) {
        const fileNames: string[] = [];
        for (const fileUrl of payload.attachments) {
          const fileName = fileUrl.split('/').pop() || 'upload.png';
          fileNames.push(fileName);
          // Auto-download into the container
          const fixedUrl = fileUrl.replace('localhost', 'host.docker.internal').replace('127.0.0.1', 'host.docker.internal');
          await this.dockerService.executeCommand(containerId!, `cd ${primaryTargetDir} && wget -qO "${fileName}" "${fixedUrl}"`);
        }
        attachmentsContext = `\n\nATTACHMENTS: The user has uploaded files which have been automatically downloaded into the root directory of your primary repository. The files are:\n${fileNames.map(f => `- ${f}`).join('\n')}\nCRITICAL: You MUST move these files to the appropriate assets directory (e.g. 'public/' or 'src/assets/' depending on the framework) and reference their local file paths in your code. DO NOT hotlink URLs directly!`;
      }

      const workspaceContext = hasSecondaryRepo 
        ? `\n\nWORKSPACE CONTEXT: You are working in a workspace with TWO repositories.
          Primary Repo: /workspace/${primaryTargetDir}
          Secondary Repo: /workspace/${payload.secondaryRepo?.name || 'secondary-repo'}
          Make sure to cd into the correct directory before making changes or running commands!
          CRITICAL: You MUST evaluate the user's instructions against BOTH repositories. Do not stop execution until you have made the necessary changes in BOTH the primary and secondary repositories if the task requires it. Do not ignore either repository!`
        : '';

      const projectType = primaryStrategy.projectType;
      const projectTypeContext = `Project Type: ${projectType}`;

      // Detect preview-only instructions
      const isPreviewOnly = this.isPreviewOnly(payload.instruction);
      const aiModel = this.getModel(payload.llm?.provider, payload.llm?.model);
      let history = '';

      if (isPreviewOnly) {
        // Preview-only mode: skip plan generation and AI execution entirely
        await this.addLog(taskId, 'info', `Preview-only mode — skipping plan and AI execution.`);
        await this.addLog(taskId, 'success', `Jumping straight to live preview setup.`);
      } else {
        // Step 2.5: Planning
        await this.addLog(taskId, 'process', `Generating Implementation Plan...`);

        const generateAndStreamPlan = async (promptText: string) => {
          let planText = '';
          let lastUpdateTime = Date.now();
          
          try {
            const { textStream } = await streamText({
              model: aiModel,
              prompt: promptText,
            });

            for await (const textPart of textStream) {
              planText += textPart;
              if (Date.now() - lastUpdateTime > 500) {
                const updatedTaskPlan = await this.prisma.task.update({
                  where: { id: taskId },
                  data: { plan: planText, status: 'awaiting-approval' },
                });
                this.tasksGateway.emitTaskUpdated(taskId, updatedTaskPlan);
                lastUpdateTime = Date.now();
              }
            }
          } catch (error: any) {
            console.error('[Agent] Plan generation error:', error);
            const detailedMsg = error?.message || error?.toString() || 'Unknown API error';
            await this.addLog(taskId, 'error', `AI Plan Generation Error: ${detailedMsg}`);
            throw new Error(`AI Plan Generation failed: ${detailedMsg}`);
          }

          if (!planText || planText.trim().length === 0) {
            await this.addLog(taskId, 'error', `AI provider returned empty response. Check ANTHROPIC_API_KEY on server.`);
            throw new Error("AI provider returned an empty response. Please check your API key or credit balance.");
          }
          
          const finalUpdatedTaskPlan = await this.prisma.task.update({
            where: { id: taskId },
            data: { plan: planText, status: 'awaiting-approval' },
          });
          this.tasksGateway.emitTaskUpdated(taskId, finalUpdatedTaskPlan);
        };

        await generateAndStreamPlan(`You are an AI developer agent. The user wants you to: ${payload.instruction}.
          Project language/framework: ${payload.meta?.language || 'Unknown'}.${workspaceContext}${attachmentsContext}
          Based on this, output a step-by-step implementation plan. 
          Format it nicely in Markdown. Do not include introductory text, just the plan.`);
        
        await this.addLog(taskId, 'info', `Waiting for user to approve the plan...`);

        let planApproved = false;
        while (!planApproved) {
          await new Promise(r => setTimeout(r, 3000));
          const currentTask = await this.prisma.task.findUnique({ where: { id: taskId } });
          if (currentTask?.status === 'cancelled') {
            await this.addLog(taskId, 'error', 'Task was cancelled by user');
            return;
          }
          if (currentTask?.status === 'in-progress' || currentTask?.status === 'plan-approved') {
            planApproved = true;
            const uTask = await this.prisma.task.update({ where: { id: taskId }, data: { status: 'in-progress' } });
            this.tasksGateway.emitTaskUpdated(taskId, uTask);
          } else if (currentTask?.status === 'plan-rejected') {
            await this.addLog(taskId, 'process', `Plan rejected. Re-generating based on feedback...`);
            await generateAndStreamPlan(`You are an AI developer agent. The user wants you to: ${currentTask?.description}.
              Output a step-by-step implementation plan. Do not include introductory text.`);
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

        while (!isTaskComplete && loopCount < 15) {
          const currentTaskLoop = await this.prisma.task.findUnique({ where: { id: taskId } });
          if (currentTaskLoop?.status === 'cancelled') {
            await this.addLog(taskId, 'error', 'Task was cancelled by user');
            return;
          }

          loopCount++;
          await this.addLog(taskId, 'process', `AI thinking... (iteration ${loopCount})`);

          try {
            const { text } = await generateText({
              model: aiModel,
              prompt: `You are an elite, Senior 10x Developer AI. The user wants you to: ${payload.instruction}.
              Project language/framework: ${payload.meta?.language || 'Unknown (inspect first)'}.
              ${projectTypeContext}
              
              CONSTITUTION & CRITICAL RULES:
              1. BEFORE writing any code, you MUST explore the codebase (using 'ls', 'cat', 'find', etc.) to understand the existing architecture, file structure, and what technology stack is being used.
              2. If the project is a Node.js project with a frontend framework (Next.js, React, etc.), create the appropriate framework components (.tsx, .jsx, etc.) and integrate them into the existing routing and layout. Do NOT create standalone .html files.
              3. If the project is a STATIC HTML/CSS/JS site (no package.json), edit the .html, .css, and .js files directly. Do NOT create package.json or try to use npm.
              4. NEVER use placeholder code (e.g. "// insert logic here"). Always write complete, production-ready code.
              5. ALWAYS verify your code before marking the task as DONE. For Node.js projects, run 'npm run build'. For static HTML, verify file paths are correct. For Python, run the relevant checks.
              6. If there is a package.json, inspect it for essential scripts (migrations, seeding, etc.) and intelligently run those commands if the task requires them.${workspaceContext}
              
              Past actions and outputs:
              ${history}
              
              We are in iteration ${loopCount} (Max 15). 
              CHAIN OF THOUGHT:
              First, briefly think step-by-step in English about what you are going to do and why.
              Then, provide a SINGLE bash command to execute in the workspace to make progress on this task.
              You MUST place your bash command inside a \`\`\`bash code block. 
              If you think the task is completely finished, output: \`\`\`bash\necho "DONE"\n\`\`\``,
            });

            // Extract bash command from code block, or fallback to full text
            const codeBlockMatch = text.match(/\`\`\`(?:bash|sh)?\n([\s\S]*?)\`\`\`/);
            const aiChosenCommand = (codeBlockMatch ? codeBlockMatch[1] : text).trim();
            
            await this.addLog(taskId, 'info', `AI Reasoning: ${text.replace(/\`\`\`(?:bash|sh)?\n[\s\S]*?\`\`\`/, '').trim() || '(No reasoning provided)'}`);
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
      }

      // Step 4: Validate
      let currentTaskFinalCheck = await this.prisma.task.findUnique({ where: { id: taskId } });
      if (currentTaskFinalCheck?.status === 'cancelled') return;

      // Adaptive dependency installation based on AI strategy (PRIMARY)
      if (primaryStrategy.installCommand) {
        await this.addLog(taskId, 'process', `Installing primary dependencies via: ${primaryStrategy.installCommand}`);
        await this.dockerService.executeCommand(containerId!, `cd ${primaryTargetDir} && ${primaryStrategy.installCommand}`, 300000);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.addLog(taskId, 'success', '✓ Primary dependencies installed');
      } else {
        await this.addLog(taskId, 'info', `Primary repo — skipping dependency installation (not required)`);
      }

      let secondaryStrategy = { installCommand: '', devCommand: '' };

      // Adaptive dependency installation for SECONDARY repo
      if (hasSecondaryRepo) {
        const secondaryDir = payload.secondaryRepo?.name || 'secondary-repo';
        secondaryStrategy = await this.getProjectSetupStrategy(containerId!, secondaryDir, 4000);
        await this.addLog(taskId, 'info', `Secondary setup strategy determined via AI.`);
        
        if (secondaryStrategy.installCommand) {
          await this.addLog(taskId, 'process', `Installing secondary dependencies via: ${secondaryStrategy.installCommand}`);
          await this.dockerService.executeCommand(containerId!, `cd ${secondaryDir} && ${secondaryStrategy.installCommand}`, 300000);
          await this.addLog(taskId, 'success', '✓ Secondary dependencies installed');
        } else {
          await this.addLog(taskId, 'info', `Secondary repo — skipping dependency installation (not required)`);
        }
      }

      currentTaskFinalCheck = await this.prisma.task.findUnique({ where: { id: taskId } });
      if (currentTaskFinalCheck?.status === 'cancelled') return;

      // Live Preview (Docker Port Mapping — no tunneling needed!)
      await this.addLog(taskId, 'process', 'Spinning up live preview...');
      
      // Extract backend domain and protocol from config to match SSL/HTTP setup
      const callbackUrl = this.configService.get<string>('GITHUB_CALLBACK_URL') || 'http://localhost';
      let backendDomain = 'localhost';
      let protocol = 'http';
      try {
        const parsedUrl = new URL(callbackUrl);
        backendDomain = parsedUrl.hostname;
        if (parsedUrl.protocol.startsWith('https')) {
          protocol = 'https';
        }
      } catch(e) {}

      if (process.env.PREVIEW_PROTOCOL) {
        protocol = process.env.PREVIEW_PROTOCOL;
      }

      const isLocalhost = backendDomain === 'localhost' || backendDomain === '127.0.0.1';
      const useSubdomain = process.env.PREVIEW_USE_SUBDOMAIN !== undefined 
        ? process.env.PREVIEW_USE_SUBDOMAIN === 'true'
        : (!isLocalhost && protocol === 'https');

      let secondaryUrlStr = '';
      let primaryUrlStr = useSubdomain 
        ? `${protocol}://${primaryHostPort}.${backendDomain}` 
        : `${protocol}://${backendDomain}:${primaryHostPort}`;
      const secondaryDir = payload.secondaryRepo?.name || 'secondary-repo';
      
      if (hasSecondaryRepo) {
        secondaryUrlStr = useSubdomain 
          ? `${protocol}://${secondaryHostPort}.${backendDomain}` 
          : `${protocol}://${backendDomain}:${secondaryHostPort}`;
        
        // Bi-directional Injection: Cross-wire both repos
        await this.dockerService.executeCommand(containerId!, `cd ${primaryTargetDir} && echo -e "NEXT_PUBLIC_API_URL=${secondaryUrlStr}\\nREACT_APP_API_URL=${secondaryUrlStr}\\nVITE_API_URL=${secondaryUrlStr}\\nAPI_URL=${secondaryUrlStr}" >> .env.local`);
        await this.dockerService.executeCommand(containerId!, `cd ${secondaryDir} && echo -e "NEXT_PUBLIC_API_URL=${primaryUrlStr}\\nREACT_APP_API_URL=${primaryUrlStr}\\nVITE_API_URL=${primaryUrlStr}\\nAPI_URL=${primaryUrlStr}" >> .env.local`);
        
        // Start secondary repo dev server
        await this.dockerService.executeCommand(containerId!, `cd ${secondaryDir} && nohup ${secondaryStrategy.devCommand} > dev.log 2>&1 &`);
      }

      // Start primary repo dev server
      await this.dockerService.executeCommand(containerId!, `cd ${primaryTargetDir} && nohup ${primaryStrategy.devCommand} > dev.log 2>&1 &`);
      
      // Wait for dev server to boot
      await new Promise(r => setTimeout(r, 5000));
      
      const updatedPreviewTask = await this.prisma.task.update({ where: { id: taskId }, data: { previewUrl: primaryUrlStr } });
      this.tasksGateway.emitTaskUpdated(taskId, updatedPreviewTask);
      const logMsg = hasSecondaryRepo ? `Live preview available at: ${primaryUrlStr} (Secondary: ${secondaryUrlStr})` : `Live preview available at: ${primaryUrlStr}`;
      await this.addLog(taskId, 'info', logMsg);

      currentTaskFinalCheck = await this.prisma.task.findUnique({ where: { id: taskId } });
      if (currentTaskFinalCheck?.status === 'cancelled') return;

      // Step 4.5: Diff
      await this.addLog(taskId, 'process', 'Generating code diff...');
      // Use git add -A first then git diff --cached to capture ALL changes (new files, staged, modified)
      await this.dockerService.executeCommand(containerId!, `cd ${primaryTargetDir} && git add -A`);
      const diffResult = await this.dockerService.executeCommand(containerId!, `cd ${primaryTargetDir} && git diff --cached`);
      const updatedDiffTask = await this.prisma.task.update({ where: { id: taskId }, data: { diff: diffResult.stdout } });
      this.tasksGateway.emitTaskUpdated(taskId, updatedDiffTask);

      // Skip build entirely if no code changes were made
      const hasCodeChanges = diffResult.stdout.trim().length > 0;

      if (!hasCodeChanges) {
        await this.addLog(taskId, 'success', '✓ No code changes detected — skipping build step');
      } else {
        // Adaptive Build Retry: re-enter AI loop on build failure, up to 2 retries
        // Adaptive build step based on project type
        if (projectType === 'node') {
          let buildRetryCount = 0;
          const maxBuildRetries = 2;
          let buildSucceeded = false;

          while (!buildSucceeded && buildRetryCount <= maxBuildRetries) {
            await this.addLog(taskId, 'process', buildRetryCount === 0 ? 'Running build...' : `Running build (retry ${buildRetryCount}/${maxBuildRetries})...`);
            const buildResult = await this.dockerService.executeCommand(containerId!, `cd ${primaryTargetDir} && npm run build`);
            await new Promise(resolve => setTimeout(resolve, 1000));

            const buildFailed = buildResult.stderr && (
              buildResult.stderr.toLowerCase().includes('error') ||
              buildResult.stderr.includes('ERR')
            );

            if (!buildFailed) {
              await this.addLog(taskId, 'success', '✓ Build completed successfully');
              buildSucceeded = true;
            } else if (buildRetryCount < maxBuildRetries) {
              buildRetryCount++;
              const buildError = buildResult.stderr.substring(0, 1500);
              await this.addLog(taskId, 'error', `Build failed. Re-entering AI loop to fix (retry ${buildRetryCount}/${maxBuildRetries})...`);
              await this.addLog(taskId, 'info', `Build error: ${buildError.substring(0, 500)}${buildError.length > 500 ? '...' : ''}`);

              // Re-enter AI loop with build error context (up to 5 iterations)
              let fixLoopCount = 0;
              let fixComplete = false;
              while (!fixComplete && fixLoopCount < 5) {
                fixLoopCount++;
                await this.addLog(taskId, 'process', `AI fixing build error... (fix iteration ${fixLoopCount})`);
                try {
                  const { text } = await generateText({
                    model: aiModel,
                    prompt: `You are an AI developer agent. The project failed to build with the following error:\n\n${buildError}\n\nThe user's original task was: ${payload.instruction}.\nProject language/framework: ${payload.meta?.language || 'Unknown'}.\n\nPast actions and outputs:\n${history}\n\nFix iteration ${fixLoopCount} of 5. Output a SINGLE bash command to fix the build error.\nDo not include markdown formatting or backticks, just the raw bash command.\nIf you believe the fix is complete, output: echo \"DONE\"`,
                  });

                  const fixCommand = text.trim();
                  await this.addLog(taskId, 'info', `> ${fixCommand}`);

                  if (fixCommand.includes('DONE')) {
                    fixComplete = true;
                    break;
                  }

                  const fixResult = await this.dockerService.executeCommand(containerId!, fixCommand);
                  await this.addLog(taskId, 'info', `Tool output: ${fixResult.stdout.substring(0, 500)}${fixResult.stdout.length > 500 ? '...' : ''}`);
                  history += `Command: ${fixCommand}\nOutput: ${fixResult.stdout || fixResult.stderr}\n\n`;
                } catch (error) {
                  await this.addLog(taskId, 'error', `AI fix generation failed: ${error.message}`);
                  break;
                }
              }
            } else {
              throw new Error(`Build failed after ${maxBuildRetries} retries. Aborting task to prevent pushing broken code to the repository.`);
            }
          }
        } else if (projectType === 'static') {
          await this.addLog(taskId, 'success', '✓ Static HTML project — no build step needed');
        } else if (projectType === 'python') {
          await this.addLog(taskId, 'success', '✓ Python project — no build step needed');
        } else {
          await this.addLog(taskId, 'info', 'Unknown project type — skipping build step');
        }
      }

      // Step 5: Await User Review
      const awaitingReviewTask = await this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'awaiting-review', logs: 'Build successful, waiting for review' },
      });
      this.tasksGateway.emitTaskUpdated(taskId, awaitingReviewTask);
      await this.addLog(taskId, 'success', `🎉 Changes are ready for review! Live preview is active.`);
      taskSuccess = true;

    } catch (error) {
      console.error(`[Agent] Task failed:`, error);
      await this.addLog(taskId, 'error', `Task failed: ${error.message}`);
      await this.updateTaskAndEmit(taskId, { status: 'failed', logs: error.message });
    } finally {
      // Do NOT delete from activeContainers here, unless it failed
      if (!taskSuccess && containerId) {
        this.activeContainers.delete(taskId);
        await this.addLog(taskId, 'info', 'Cleaning up workspace due to failure...');
        await this.dockerService.cleanupWorkspace(containerId);
        await this.addLog(taskId, 'info', 'Workspace destroyed');
      } else if (taskSuccess && containerId) {
        await this.addLog(taskId, 'info', 'Keeping workspace alive for Live Preview (auto-destructs in 30 minutes)...');
        // Let it auto-destruct eventually if abandoned
        setTimeout(async () => {
          if (this.activeContainers.has(taskId)) {
             this.activeContainers.delete(taskId);
             await this.dockerService.cleanupWorkspace(containerId!).catch(console.error);
             await this.updateTaskAndEmit(taskId, { status: 'cancelled' }).catch(console.error);
             await this.addLog(taskId, 'warning', 'Workspace destroyed automatically after 30 minutes of inactivity.');
          }
        }, 30 * 60 * 1000);
      }
    }
  }

  // --- NEW METHODS FOR INTERACTIVE EXECUTION ---
  async commitAndPushTask(taskId: string) {
    const containerId = this.activeContainers.get(taskId);
    if (!containerId) {
      await this.updateTaskAndEmit(taskId, { status: 'failed' });
      await this.addLog(taskId, 'error', 'Task container is no longer active or has expired. Cannot push changes.');
      throw new Error('Task container is no longer active or expired.');
    }

    const task = await this.prisma.task.findUnique({ where: { id: taskId }, include: { user: true } });
    if (!task) throw new Error('Task not found');
    
    try {
      await this.updateTaskAndEmit(taskId, { status: 'pushing' });
      await this.addLog(taskId, 'process', 'Pushing approved changes to GitHub...');

      const targetBranch = task.branchName || `ai-task-${taskId}`;
      const primaryTargetDir = task.secondaryRepoUrl ? task.repoName || 'primary-repo' : '.';
      
      await this.dockerService.commitAndPush(containerId, targetBranch, `AI: ${task.description}`, task.user.accessToken || undefined, task.repoUrl || undefined, primaryTargetDir);
      
      if (task.secondaryRepoUrl) {
        const secondaryTargetBranch = task.secondaryBranchName || `ai-task-${taskId}`;
        const secondaryTargetDir = task.secondaryRepoName || 'secondary-repo';
        await this.dockerService.commitAndPush(containerId, secondaryTargetBranch, `AI: ${task.description}`, task.user.accessToken || undefined, task.secondaryRepoUrl || undefined, secondaryTargetDir);
      }

      await this.addLog(taskId, 'success', `✓ Changes pushed successfully to ${targetBranch}`);
      await this.updateTaskAndEmit(taskId, { status: 'completed' });
    } catch (e: any) {
      await this.addLog(taskId, 'error', `Failed to push changes: ${e.message}`);
      await this.updateTaskAndEmit(taskId, { status: 'failed' });
    } finally {
      this.activeContainers.delete(taskId);
      await this.dockerService.cleanupWorkspace(containerId);
      await this.addLog(taskId, 'info', 'Workspace cleaned up after push.');
    }
  }

  async discardTask(taskId: string) {
    const containerId = this.activeContainers.get(taskId);
    
    await this.updateTaskAndEmit(taskId, { status: 'cancelled' });
    await this.addLog(taskId, 'warning', 'Task discarded by user. Cleaning up workspace...');
    
    if (containerId) {
      this.activeContainers.delete(taskId);
      await this.dockerService.cleanupWorkspace(containerId);
    }
  }

  async refineTask(taskId: string, newInstruction: string, attachments?: string[]) {
    const containerId = this.activeContainers.get(taskId);
    if (!containerId) {
      await this.updateTaskAndEmit(taskId, { status: 'failed' });
      await this.addLog(taskId, 'error', 'Task container is no longer active or has expired. Cannot refine.');
      throw new Error('Task container is no longer active.');
    }

    const task = await this.prisma.task.findUnique({ where: { id: taskId }, include: { user: true } });
    if (!task) throw new Error('Task not found');

    await this.updateTaskAndEmit(taskId, { status: 'in-progress' });
    await this.addLog(taskId, 'process', `Executing refinement: ${newInstruction}`);

    try {
      const aiModel = this.getModel(task.llmProvider || undefined, task.llmModel || undefined);
      const hasSecondaryRepo = !!task.secondaryRepoUrl;
      const primaryTargetDir = hasSecondaryRepo ? task.repoName || 'primary-repo' : '.';
      
      const workspaceContext = hasSecondaryRepo 
        ? `\n\nWORKSPACE CONTEXT: You are working in a workspace with TWO repositories.
          Primary Repo: /workspace/${primaryTargetDir}
          Secondary Repo: /workspace/${task.secondaryRepoName || 'secondary-repo'}
          Make sure to cd into the correct directory before making changes or running commands!
          CRITICAL: You MUST evaluate the user's instructions against BOTH repositories. Do not stop execution until you have made the necessary changes in BOTH the primary and secondary repositories if the task requires it. Do not ignore either repository!`
        : '';
        
      let attachmentsContext = '';
      if (attachments && attachments.length > 0) {
        const fileNames: string[] = [];
        for (const fileUrl of attachments) {
          const fileName = fileUrl.split('/').pop() || 'upload.png';
          fileNames.push(fileName);
          const fixedUrl = fileUrl.replace('localhost', 'host.docker.internal').replace('127.0.0.1', 'host.docker.internal');
          await this.dockerService.executeCommand(containerId, `cd ${primaryTargetDir} && wget -qO "${fileName}" "${fixedUrl}"`);
        }
        attachmentsContext = `\n\nATTACHMENTS: The user has uploaded files for this refinement which have been automatically downloaded into the root directory of your primary repository. The files are:\n${fileNames.map(f => `- ${f}`).join('\n')}\nCRITICAL: You MUST move these files to the appropriate assets directory (e.g. 'public/' or 'src/assets/' depending on the framework) and reference their local file paths in your code. DO NOT hotlink URLs directly!`;
      }
        
      let isTaskComplete = false;
      let loopCount = 0;
      let history = '';
      let hasFailed = false;
      
      while (!isTaskComplete && loopCount < 10) {
        loopCount++;
        await this.addLog(taskId, 'process', `AI refining... (iteration ${loopCount})`);
        
        try {
          const { text } = await generateText({
            model: aiModel,
            prompt: `You are an elite, Senior 10x Developer AI. The user wants you to perform a follow-up refinement on an existing running codebase: ${newInstruction}.
            CONSTITUTION & CRITICAL RULES:
            1. The codebase is already running and cloned. You are inside the Docker container.
            2. BEFORE making changes, explore the project structure first (ls, cat, find) to understand what you're working with.
            3. NEVER use placeholder code. Always write complete, production-ready code.
            ${workspaceContext}
            ${attachmentsContext}
            
            Past actions and outputs in this refinement session:
            ${history}
            
            We are in iteration ${loopCount} (Max 10). 
            CHAIN OF THOUGHT:
            First, briefly think step-by-step in English about what you are going to do and why.
            Then, provide a SINGLE bash command to execute in the workspace to make progress on this task.
            You MUST place your bash command inside a \`\`\`bash code block. 
            If you think the refinement is completely finished, output: \`\`\`bash\necho "DONE"\n\`\`\``,
          });

          // Extract bash command from code block, or fallback to full text
          const codeBlockMatch = text.match(/```(?:bash|sh)?\n([\s\S]*?)```/);
          const command = (codeBlockMatch ? codeBlockMatch[1] : text).trim();
          
          await this.addLog(taskId, 'info', `AI Reasoning: ${text.replace(/```(?:bash|sh)?\n[\s\S]*?```/, '').trim() || '(No reasoning provided)'}`);

          if (command) {
            await this.addLog(taskId, 'info', `> ${command.substring(0, 500)}${command.length > 500 ? '...' : ''}`);
            if (command.includes('DONE')) {
              isTaskComplete = true;
              break;
            }

            const result = await this.dockerService.executeCommand(containerId, command);
            let truncatedOutput = result.stdout || result.stderr || 'Command executed silently.';
            if (truncatedOutput.length > 2000) truncatedOutput = truncatedOutput.substring(0, 2000) + '\n... [OUTPUT TRUNCATED]';
            
            await this.addLog(taskId, 'info', `Tool output: ${truncatedOutput.substring(0, 500)}${truncatedOutput.length > 500 ? '...' : ''}`);
            history += `Command: ${command}\nOutput:\n${truncatedOutput}\n\n`;
          } else {
             break;
          }
        } catch (error) {
          const errMsg = error?.message || String(error);
          const userMsg = errMsg.includes('model') 
            ? `The AI model encountered an error. This may be a temporary API issue. Please try again.`
            : `AI execution error: ${errMsg.substring(0, 200)}`;
          await this.addLog(taskId, 'error', userMsg);
          hasFailed = true;
          break;
        }
      }
      
      if (hasFailed) {
        // Don't overwrite the diff or claim success — retain previous state
        await this.updateTaskAndEmit(taskId, { status: 'awaiting-review' });
        await this.addLog(taskId, 'warning', 'Refinement encountered an error. Your previous code is still intact for review.');
      } else {
        // Re-generate diff after successful refinement
        await this.addLog(taskId, 'process', 'Generating updated code diff...');
        await this.dockerService.executeCommand(containerId!, `cd ${primaryTargetDir} && git add -A`);
        const diffResult = await this.dockerService.executeCommand(containerId!, `cd ${primaryTargetDir} && git diff --cached`);
        await this.updateTaskAndEmit(taskId, { diff: diffResult.stdout, status: 'awaiting-review' });
        await this.addLog(taskId, 'success', `Refinement complete. Waiting for review.`);
      }
      
    } catch (e: any) {
      await this.addLog(taskId, 'error', `Failed to refine task: ${e.message}`);
      await this.updateTaskAndEmit(taskId, { status: 'awaiting-review' });
    }
  }

  async mergeTask(taskId: string, targetMergeBranch: string) {
    const containerId = this.activeContainers.get(taskId);
    if (!containerId) {
      await this.updateTaskAndEmit(taskId, { status: 'failed' });
      await this.addLog(taskId, 'error', 'Task container is no longer active or has expired. Cannot merge changes.');
      throw new Error('Task container is no longer active or expired.');
    }

    const task = await this.prisma.task.findUnique({ where: { id: taskId }, include: { user: true } });
    if (!task) throw new Error('Task not found');

    await this.updateTaskAndEmit(taskId, { status: 'in-progress' });
    await this.addLog(taskId, 'process', `Initiating merge into ${targetMergeBranch}...`);

    try {
      const aiModel = this.getModel(task.llmProvider || undefined, task.llmModel || undefined);

      await this.dockerService.executeCommand(containerId, `git config --global user.email "bot@pocketdev.app"`);
      await this.dockerService.executeCommand(containerId, `git config --global user.name "PocketDev AI"`);

      const reposToMerge = [
        { dir: task.secondaryRepoUrl ? task.repoName || 'primary-repo' : '.', source: task.branchName || `ai-task-${taskId}`, url: task.repoUrl }
      ];
      if (task.secondaryRepoUrl) {
        reposToMerge.push({
          dir: task.secondaryRepoName || 'secondary-repo',
          source: task.secondaryBranchName || `ai-task-${taskId}`,
          url: task.secondaryRepoUrl
        });
      }

      for (const repo of reposToMerge) {
        const d = repo.dir;
        await this.addLog(taskId, 'process', `[${d === '.' ? 'Primary Repo' : d}] Committing changes to ${repo.source}...`);
        await this.dockerService.executeCommand(containerId, `cd ${d} && (env GIT_TERMINAL_PROMPT=0 git checkout -b ${repo.source} || env GIT_TERMINAL_PROMPT=0 git checkout ${repo.source})`);
        await this.dockerService.executeCommand(containerId, `cd ${d} && git add -A`);
        await this.dockerService.executeCommand(containerId, `cd ${d} && (git commit -m "AI: ${task.description}" || echo "No changes to commit")`);

        await this.addLog(taskId, 'process', `[${d === '.' ? 'Primary Repo' : d}] Checking out and pulling ${targetMergeBranch}...`);
        if (repo.url && task.user.accessToken) {
          const authUrl = repo.url.replace('https://', `https://${task.user.accessToken}@`);
          await this.dockerService.executeCommand(containerId, `cd ${d} && git remote set-url origin ${authUrl}`);
        }
        await this.dockerService.executeCommand(containerId, `cd ${d} && git fetch origin`);
        await this.dockerService.executeCommand(containerId, `cd ${d} && (env GIT_TERMINAL_PROMPT=0 git checkout ${targetMergeBranch} || env GIT_TERMINAL_PROMPT=0 git checkout -b ${targetMergeBranch} origin/${targetMergeBranch} || env GIT_TERMINAL_PROMPT=0 git checkout -b ${targetMergeBranch})`);
        await this.dockerService.executeCommand(containerId, `cd ${d} && (env GIT_TERMINAL_PROMPT=0 git pull origin ${targetMergeBranch} || echo "No remote branch yet")`);

        await this.addLog(taskId, 'process', `[${d === '.' ? 'Primary Repo' : d}] Merging ${repo.source} into ${targetMergeBranch}...`);
        const mergeResult = await this.dockerService.executeCommand(containerId, `cd ${d} && env GIT_TERMINAL_PROMPT=0 git merge ${repo.source}`);

        if (mergeResult.exitCode !== 0) {
          // Merge conflict detected
          await this.addLog(taskId, 'warning', `[${d === '.' ? 'Primary Repo' : d}] Merge conflict detected! Engaging AI Conflict Resolution Loop...`);
          await this.addLog(taskId, 'info', mergeResult.stdout || mergeResult.stderr);
          
          let fixLoopCount = 0;
          let fixComplete = false;
          let history = `Merge conflict output:\n${mergeResult.stdout || mergeResult.stderr}\n\n`;

          while (!fixComplete && fixLoopCount < 5) {
            fixLoopCount++;
            await this.addLog(taskId, 'process', `[${d === '.' ? 'Primary Repo' : d}] AI resolving conflicts... (iteration ${fixLoopCount})`);
            try {
              const { text } = await generateText({
                model: aiModel,
                prompt: `You are an AI developer agent. You encountered a merge conflict while merging ${repo.source} into ${targetMergeBranch} in directory ${d}.
                
Project language/framework: ${((task as any).meta)?.language || 'Unknown'}.

Past actions and outputs:
${history}

Fix iteration ${fixLoopCount} of 5. You MUST resolve standard Git merge conflict markers (<<<<<<<, =======, >>>>>>>) in the files, verify the fix passes if applicable, and then run \`git add -A && git commit -m "Resolve merge conflicts"\`.
Output a SINGLE bash command to make progress or resolve the conflict.
Do not include markdown formatting or backticks, just the raw bash command.
If you believe the fix is completely finished and committed, output: echo "DONE"`,
              });

              const fixCommand = text.match(/\`\`\`(?:bash|sh)?\n([\s\S]*?)\`\`\`/) ? text.match(/\`\`\`(?:bash|sh)?\n([\s\S]*?)\`\`\`/)![1].trim() : text.trim();
              await this.addLog(taskId, 'info', `> ${fixCommand}`);

              if (fixCommand.includes('DONE')) {
                fixComplete = true;
                break;
              }

              const fixResult = await this.dockerService.executeCommand(containerId, `cd ${d} && ${fixCommand}`);
              await this.addLog(taskId, 'info', `Tool output: ${fixResult.stdout.substring(0, 500)}${fixResult.stdout.length > 500 ? '...' : ''}`);
              history += `Command: ${fixCommand}\nOutput: ${fixResult.stdout || fixResult.stderr}\n\n`;
            } catch (error) {
              await this.addLog(taskId, 'error', `AI conflict resolution failed: ${error.message}`);
              break;
            }
          }

          if (!fixComplete) {
            throw new Error(`[${d === '.' ? 'Primary Repo' : d}] AI was unable to resolve merge conflicts within 5 iterations.`);
          }
        }

        await this.addLog(taskId, 'success', `✓ [${d === '.' ? 'Primary Repo' : d}] Clean merge. Pushing to ${targetMergeBranch}...`);
        const pushResult = await this.dockerService.executeCommand(containerId, `cd ${d} && env GIT_TERMINAL_PROMPT=0 git push origin ${targetMergeBranch}`);
        if (pushResult.exitCode !== 0) throw new Error(`[${d === '.' ? 'Primary Repo' : d}] Push failed: ${pushResult.stderr}`);
      }

      await this.addLog(taskId, 'success', `✓ All repositories merged and pushed successfully to ${targetMergeBranch}`);
      await this.updateTaskAndEmit(taskId, { status: 'completed' });
      
      this.activeContainers.delete(taskId);
      await this.dockerService.cleanupWorkspace(containerId);

    } catch (e: any) {
      await this.addLog(taskId, 'error', `Failed to merge task: ${e.message}`);
      await this.updateTaskAndEmit(taskId, { status: 'awaiting-review' });
    }
  }

  async cancelTaskExecution(taskId: string) {
    const containerId = this.activeContainers.get(taskId);
    if (containerId) {
      console.log(`[Agent] Hard killing container for cancelled task: ${taskId}`);
      await this.dockerService.cleanupWorkspace(containerId);
      this.activeContainers.delete(taskId);
    }
  }
}
