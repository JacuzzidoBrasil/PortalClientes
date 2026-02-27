from pydantic import BaseModel
from typing import List, Optional

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class LoginRequest(BaseModel):
    cnpj: str
    password: str

class AccessLevelItem(BaseModel):
    id: int
    name: str

class UserCreate(BaseModel):
    cnpj: str
    name: str
    email: Optional[str] = None
    uf: str
    password: Optional[str] = None
    access_level_ids: List[int]
    is_admin: bool = False

class UserAccessUpdate(BaseModel):
    access_level_ids: List[int]

class UserItem(BaseModel):
    id: int
    cnpj: str
    name: str
    email: Optional[str] = None
    uf: Optional[str] = None
    is_admin: bool
    access_levels: List[AccessLevelItem]

class SpreadsheetCreate(BaseModel):
    title: str
    access_level_ids: List[int]

class SpreadsheetItem(BaseModel):
    id: int
    title: str

class SpreadsheetItemAdmin(BaseModel):
    id: int
    title: str
    access_levels: List[AccessLevelItem]

class SpreadsheetData(BaseModel):
    columns: List[str]
    rows: List[dict]

class FirstAccessRequest(BaseModel):
    cnpj: str
    email: str

class FirstAccessConfirm(BaseModel):
    cnpj: str
    email: str
    code: str
    new_password: str

class PasswordResetRequest(BaseModel):
    cnpj: str
    email: str

class PasswordResetConfirm(BaseModel):
    cnpj: str
    email: str
    code: str
    new_password: str
