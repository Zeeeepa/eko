import { LLMProviderFactory } from '../services/llm/provider-factory';
import { WorkflowGenerator } from '../services/workflow/generator';
import {
  LLMConfig,
  EkoConfig,
  EkoInvokeParam,
  LLMProvider,
  Tool,
  Workflow,
  WorkflowCallback,
  ExecutionContext,
  WorkflowResult,
} from '../types';
import { ToolRegistry } from './tool-registry';
import { logger } from '../common/log';
import { ILogObj, Logger } from 'tslog';

/**
 * Eko core
 */
export class Eko {
  public static tools: Map<string, Tool<any, any>> = new Map();

  private llmProvider: LLMProvider;
  private ekoConfig: EkoConfig;
  private toolRegistry = new ToolRegistry();
  private workflowGeneratorMap = new Map<Workflow, WorkflowGenerator>();
  public prompt: string = '';
  public tabs: chrome.tabs.Tab[] = [];
  public workflow?: Workflow = undefined;

  constructor(llmConfig: LLMConfig, ekoConfig?: EkoConfig) {
    this.llmProvider = LLMProviderFactory.buildLLMProvider(llmConfig);
    this.ekoConfig = this.buildEkoConfig(ekoConfig);
    this.registerTools();
    logger.info("using Eko@" + process.env.COMMIT_HASH);
    logger.debug("caller's ekoConfig:", ekoConfig);
  }

  public static getLogger(): Logger<ILogObj> {
    return logger;
  }

  private buildEkoConfig(ekoConfig: Partial<EkoConfig> | undefined): EkoConfig {
    if (!ekoConfig) {
      logger.warn("`ekoConfig` is missing when construct `Eko` instance");
    }
    const defaultEkoConfig: EkoConfig = {
      workingWindowId: undefined,
      chromeProxy: typeof chrome === 'undefined' ? undefined : chrome,
      callback: undefined,
      patchServerUrl: "http://127.0.0.1:8000/eko",
    };
    return {
      ...defaultEkoConfig,
      ...ekoConfig,
    };
  }

  private registerTools() {
    let tools = Array.from(Eko.tools.entries()).map(([_key, tool]) => tool);

    // filter human tools by callbacks
    const callback = this.ekoConfig.callback;
    if (callback) {
      const hooks = callback.hooks;

      // these tools could not work without corresponding hook
      const tool2isHookExists: { [key: string]: boolean } = {
        'human_input_text': Boolean(hooks.onHumanInputText),
        'human_input_single_choice': Boolean(hooks.onHumanInputSingleChoice),
        'human_input_multiple_choice': Boolean(hooks.onHumanInputMultipleChoice),
        'human_operate': Boolean(hooks.onHumanOperate),
      };
      tools = tools.filter(tool => {
        if (tool.name in tool2isHookExists) {
          let isHookExists = tool2isHookExists[tool.name];
          return isHookExists;
        } else {
          return true;
        }
      });
    } else {
      logger.warn("`ekoConfig.callback` is missing when construct `Eko` instance.")
    }
    tools.forEach(tool => this.toolRegistry.registerTool(tool));
  }

  public async generate(prompt: string, tabs: chrome.tabs.Tab[] = [], param?: EkoInvokeParam): Promise<Workflow> {
    logger.info("workflow generating...", prompt);
    this.prompt = prompt;
    this.tabs = tabs;
    let toolRegistry = this.toolRegistry;
    if (param && param.tools && param.tools.length > 0) {
      toolRegistry = new ToolRegistry();
      for (let i = 0; i < param.tools.length; i++) {
        let tool = param.tools[i];
        if (typeof tool == 'string') {
          toolRegistry.registerTool(this.getTool(tool));
        } else {
          toolRegistry.registerTool(tool);
        }
      }
    }
    const generator = new WorkflowGenerator(this.llmProvider, toolRegistry);
    const workflow = await generator.generateWorkflow(prompt, this.ekoConfig);
    this.workflowGeneratorMap.set(workflow, generator);
    this.workflow = workflow;
    logger.info("workflow generating...done");
    return workflow;
  }

  public async execute(workflow: Workflow): Promise<WorkflowResult> {
    logger.info("workflow executing...");
    let prompt = this.prompt;
    let description = '';
    workflow.nodes.forEach(node => {
      description += node.name + '\n';
    });
    const json = {
      'id': 'workflow_id',
      'name': prompt,
      'description': prompt,
      'nodes': [
        {
          'id': '1',
          'type': 'action',
          'action': {
            'type': 'prompt',
            'name': "在 Boss 直聘上搜索上海运营岗位",
            'description': "使用 open_url 工具进入 Boss 直聘网站，在搜索框输入岗位信息：“上海运营”，然后搜索。",
            'tools': [
              'browser_use',
              'open_url',
              'human_operate',
            ],
          },
          'dependencies': [],
        },
        {
          'id': '2',
          'type': 'action',
          'action': {
            'type': 'prompt',
            'name': "搜索页提取 URL",
            'description': "使用 extract_content 工具在搜索页提取 5 个运营岗位子页面的 URL，并写入上下文",
            'tools': [
              'browser_use',
              'extract_content',
              'human_operate',
            ],
          },
          'dependencies': ['1'],
        },
        {
          'id': '3',
          'type': 'action',
          'action': {
            'type': 'prompt',
            'name': "投递第 1 个运营岗位",
            'description': "根据上下文信息打开第 1 个运营岗位：1. 使用 open_url 工具打开岗位详情页：https://www.zhipin.com/job_detail/887c0d1c7479ab4403V60tS7EltX.html；2. 使用 extract_content 工具提取页面信息；3. 使用 document_agent 工具撰写个人介绍，不超过 200 字；4. 使用 browser_use 工具点击”立即沟通“按钮；5. 使用 browser_use 工具把之前生成的个人介绍粘贴在输入框并发送。",
            'tools': [
              'browser_use',
              'document_agent',
              'open_url',
              'human_operate',
            ],
          },
          'dependencies': ['2'],
        },
        {
          'id': '4',
          'type': 'action',
          'action': {
            'type': 'prompt',
            'name': "投递第 2 个运营岗位",
            'description': "根据上下文信息打开第 2 个运营岗位：1. 使用 open_url 工具打开岗位详情页：https://www.zhipin.com/job_detail/dbc2ee5a76a18d2e03V70tu_FlVY.html；2. 使用 extract_content 工具提取页面信息；3. 使用 document_agent 工具撰写个人介绍，不超过 200 字；4. 使用 browser_use 工具点击”立即沟通“按钮；5. 使用 browser_use 工具把之前生成的个人介绍粘贴在输入框并发送。",
            'tools': [
              'browser_use',
              'document_agent',
              'open_url',
              'human_operate',
            ],
          },
          'dependencies': ['3'],
        },
        {
          'id': '5',
          'type': 'action',
          'action': {
            'type': 'prompt',
            'name': "投递第 3 个运营岗位",
            'description': "根据上下文信息打开第 3 个运营岗位：1. 使用 open_url 工具打开岗位详情页：https://www.zhipin.com/job_detail/c5d55cec127b0ada03Ry2dm9FFpV.html；2. 使用 extract_content 工具提取页面信息；3. 使用 document_agent 工具撰写个人介绍，不超过 200 字；4. 使用 browser_use 工具点击”立即沟通“按钮；5. 使用 browser_use 工具把之前生成的个人介绍粘贴在输入框并发送。",
            'tools': [
              'browser_use',
              'document_agent',
              'open_url',
              'human_operate',
            ],
          },
          'dependencies': ['4'],
        },
        {
          'id': '6',
          'type': 'action',
          'action': {
            'type': 'prompt',
            'name': "投递第 4 个运营岗位",
            'description': "根据上下文信息打开第 4 个运营岗位：1. 使用 open_url 工具打开岗位详情页：https://www.zhipin.com/job_detail/110c09c2d589bd3503V73Nm9EFBT.html；2. 使用 extract_content 工具提取页面信息；3. 使用 document_agent 工具撰写个人介绍，不超过 200 字；4. 使用 browser_use 工具点击”立即沟通“按钮；5. 使用 browser_use 工具把之前生成的个人介绍粘贴在输入框并发送。",
            'tools': [
              'browser_use',
              'document_agent',
              'open_url',
              'human_operate',
            ],
          },
          'dependencies': ['5'],
        },
        {
          'id': '7',
          'type': 'action',
          'action': {
            'type': 'prompt',
            'name': "投递第 5 个运营岗位",
            'description': "根据上下文信息打开第 5 个运营岗位：1. 使用 open_url 工具打开岗位详情页：https://www.zhipin.com/job_detail/887c0d1c7479ab4403V60tS7EltX.html；2. 使用 extract_content 工具提取页面信息；3. 使用 document_agent 工具撰写个人介绍，不超过 200 字；4. 使用 browser_use 工具点击”立即沟通“按钮；5. 使用 browser_use 工具把之前生成的个人介绍粘贴在输入框并发送。",
            'tools': [
              'browser_use',
              'document_agent',
              'open_url',
              'human_operate',
            ],
          },
          'dependencies': ['6'],
        },
      ],
    };
    logger.debug("workflow", json);    
    logger.debug("LLMProvider", {
      client: (typeof this.llmProvider.client),
      defaultModel: this.llmProvider.defaultModel,
    });
    
    const generator = new WorkflowGenerator(this.llmProvider, this.toolRegistry);
    workflow = await generator.generateWorkflowFromJson(json, this.ekoConfig);
    this.workflow = workflow;

    // Inject LLM provider at workflow level
    workflow.llmProvider = this.llmProvider;

    // Process each node's action
    for (const node of workflow.nodes) {
      if (node.action.type === 'prompt') {
        // Inject LLM provider
        node.action.llmProvider = this.llmProvider;

        // Resolve tools
        node.action.tools = node.action.tools.map(tool => {
          if (typeof tool === 'string') {
            return this.toolRegistry.getTool(tool);
          }
          return tool;
        });
      }
    }

    const result = await workflow.execute(this.ekoConfig.callback);
    logger.debug(result);
    logger.info("workflow executing...done");
    return result;
  }

  public async cancel(): Promise<void> {
    if (this.workflow) {
      return await this.workflow.cancel();
    } else {
      throw Error('`Eko` instance do not have a `workflow` member');
    }
  }


  public async modify(workflow: Workflow, prompt: string): Promise<Workflow> {
    const generator = this.workflowGeneratorMap.get(workflow) as WorkflowGenerator;
    workflow = await generator.modifyWorkflow(prompt, this.ekoConfig);
    this.workflowGeneratorMap.set(workflow, generator);
    return workflow;
  }

  private getTool(toolName: string) {
    let tool: Tool<any, any>;
    if (this.toolRegistry.hasTools([toolName])) {
      tool = this.toolRegistry.getTool(toolName);
    } else if (Eko.tools.has(toolName)) {
      tool = Eko.tools.get(toolName) as Tool<any, any>;
    } else {
      throw new Error(`Tool with name ${toolName} not found`);
    }
    return tool;
  }

  public async callTool(toolName: string, input: object, callback?: WorkflowCallback): Promise<any>;
  public async callTool(
    tool: Tool<any, any>,
    input: object,
    callback?: WorkflowCallback,
  ): Promise<any>;

  public async callTool(
    tool: Tool<any, any> | string,
    input: object,
    callback?: WorkflowCallback,
  ): Promise<any> {
    if (typeof tool === 'string') {
      tool = this.getTool(tool);
    }
    let context: ExecutionContext = {
      llmProvider: this.llmProvider,
      ekoConfig: this.ekoConfig,
      variables: new Map<string, unknown>(),
      tools: new Map<string, Tool<any, any>>(),
      callback,
    };
    let result = await tool.execute(context, input);
    if (tool.destroy) {
      tool.destroy(context);
    }
    return result;
  }

  public registerTool(tool: Tool<any, any>): void {
    this.toolRegistry.registerTool(tool);
  }

  public unregisterTool(toolName: string): void {
    this.toolRegistry.unregisterTool(toolName);
  }
}

export default Eko;
