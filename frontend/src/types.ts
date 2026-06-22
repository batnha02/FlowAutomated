export type ActionType =
  | 'left_click'
  | 'right_click'
  | 'double_click'
  | 'keyboard_input'
  | 'open_app'
  | 'browser_click'
  | 'browser_type'
  | 'browser_navigate'
  | 'browser_wait'
  | 'browser_screenshot'
  | 'delay';

export interface Step {
  id: string;
  name: string;
  actionType: ActionType;
  target?: string;
  value?: string;
  delay?: number;
  description?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: Step[];
  isPublic: boolean;
  ownerId: number;
  ownerUsername: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: number;
  username: string;
  isAdmin: boolean;
}

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface StepExecState {
  status: StepStatus;
  error?: string;
}

export const ACTION_LABELS: Record<ActionType, string> = {
  left_click: 'Left Click',
  right_click: 'Right Click',
  double_click: 'Double Click',
  keyboard_input: 'Keyboard Input',
  open_app: 'Open App',
  browser_click: 'Browser: Click',
  browser_type: 'Browser: Type',
  browser_navigate: 'Browser: Navigate',
  browser_wait: 'Browser: Wait Element',
  browser_screenshot: 'Browser: Screenshot',
  delay: 'Delay'
};

export const ACTION_GROUPS = {
  'Windows GUI': ['left_click', 'right_click', 'double_click', 'keyboard_input', 'open_app'] as ActionType[],
  'Browser (Playwright)': ['browser_click', 'browser_type', 'browser_navigate', 'browser_wait', 'browser_screenshot'] as ActionType[],
  'Utility': ['delay'] as ActionType[]
};

export const ACTION_TARGET_LABEL: Record<ActionType, string> = {
  left_click: 'Coordinates (x,y)',
  right_click: 'Coordinates (x,y)',
  double_click: 'Coordinates (x,y)',
  keyboard_input: 'Window Title (optional, to focus)',
  open_app: 'App Path or Command',
  browser_click: 'CSS Selector / XPath',
  browser_type: 'CSS Selector / XPath',
  browser_navigate: 'URL',
  browser_wait: 'CSS Selector / XPath',
  browser_screenshot: 'File Path to Save',
  delay: ''
};

export const ACTION_VALUE_LABEL: Record<ActionType, string> = {
  left_click: '',
  right_click: '',
  double_click: '',
  keyboard_input: 'Text to Type',
  open_app: '',
  browser_click: '',
  browser_type: 'Text to Type',
  browser_navigate: '',
  browser_wait: 'Timeout (ms)',
  browser_screenshot: '',
  delay: 'Duration (ms)'
};
