from typing import List, Literal, Optional
from pydantic import BaseModel

ActionType = Literal[
    'left_click', 'right_click', 'double_click', 'keyboard_input', 'open_app',
    'browser_click', 'browser_type', 'browser_navigate', 'browser_wait',
    'browser_screenshot', 'delay',
]


class Step(BaseModel):
    id: str
    name: str
    actionType: ActionType
    target: Optional[str] = None
    value: Optional[str] = None
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


class UpdateUserRequest(BaseModel):
    isAdmin: bool
