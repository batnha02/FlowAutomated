export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  is_admin: number;
  created_at: string;
}

export interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  steps: string;
  is_public: number;
  owner_id: number;
  owner_username?: string;
  created_at: string;
  updated_at: string;
}

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

export interface JwtPayload {
  id: number;
  username: string;
  isAdmin: boolean;
}
