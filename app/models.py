from typing import List, Literal, Optional
from pydantic import BaseModel

ActionType = Literal[
    'left_click', 'right_click', 'double_click', 'keyboard_input', 'open_app',
    'hot_key', 'close_app', 'move_window',
    'browser_click', 'browser_type', 'browser_navigate', 'browser_wait',
    'browser_screenshot', 'delay',
]


class Step(BaseModel):
    id: str
    name: str
    actionType: ActionType
    target: Optional[str] = None
    value: Optional[str] = None
    masked: Optional[bool] = None
    delay: Optional[int] = None
    description: Optional[str] = None


class WorkflowCreate(BaseModel):
    name: str
    description: str = ''
    steps: List[Step] = []
    isPublic: bool = False


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    steps: Optional[List[Step]] = None
    isPublic: Optional[bool] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    isAdmin: bool = False
    managerId: Optional[int] = None


class UpdateUserRequest(BaseModel):
    isAdmin: Optional[bool] = None
    managerId: Optional[int] = None


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str


class AdminChangePasswordRequest(BaseModel):
    newPassword: str


class PermissionRequest(BaseModel):
    userId: int
    canView: bool = False
    canRun: bool = False
    canEdit: bool = False
    canDelete: bool = False


class TriggerRequest(BaseModel):
    targetWorkflowId: str
    triggerType: str = 'on_complete'
    triggerStepIndex: Optional[int] = None


class ScheduleRequest(BaseModel):
    timeOfDay: str = '09:00'
    daysOfWeek: List[int] = []
    daysOfMonth: List[int] = []
    isActive: bool = True
