from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from backend.models import JobStatus


class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    location: Optional[str] = None
    headline: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    github_url: Optional[str] = None
    resume_url: Optional[str] = None


class UserCreate(UserBase):
    password: Optional[str] = None


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    location: Optional[str] = None
    headline: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    github_url: Optional[str] = None
    resume_url: Optional[str] = None


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    profile_summary: Optional[str] = None
    profile_updated_at: Optional[datetime] = None
    analytics_ai_enabled: bool = False


class UserSettingsUpdate(BaseModel):
    analytics_ai_enabled: Optional[bool] = None


class AuthRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=4, max_length=128)
    full_name: Optional[str] = Field(default=None, max_length=255)


class AuthLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class AuthToken(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str
    reset_token: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    reset_token: str = Field(min_length=10)
    new_password: str = Field(min_length=4, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=4, max_length=128)


class AIConnectionBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    provider: str = Field(min_length=1, max_length=64)
    base_url: Optional[str] = None
    model: str = Field(min_length=1, max_length=128)
    api_key: Optional[str] = None
    is_default: bool = False


class AIConnectionCreate(AIConnectionBase):
    pass


class AIConnectionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    provider: str
    base_url: Optional[str]
    model: str
    has_api_key: bool = False
    is_default: bool
    created_at: datetime
    updated_at: datetime


class AIConnectionUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    provider: Optional[str] = Field(default=None, min_length=1, max_length=64)
    base_url: Optional[str] = None
    model: Optional[str] = Field(default=None, min_length=1, max_length=128)
    api_key: Optional[str] = None
    is_default: Optional[bool] = None


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    location: Optional[str] = None
    headline: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    github_url: Optional[str] = None
    resume_url: Optional[str] = None
    resume_text: Optional[str] = None


class ProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    profile_summary: str
    profile_updated_at: datetime


class RankingRuleBase(BaseModel):
    user_id: int
    name: str = Field(min_length=1, max_length=255)
    attribute: str = Field(min_length=1, max_length=64)
    condition: str = Field(min_length=1, max_length=16)
    match_value: str = Field(min_length=0, max_length=255)
    weight: float = Field(ge=0, le=100)
    is_active: bool = True


class RankingRuleCreate(RankingRuleBase):
    pass


class ReplaceRulesRequest(BaseModel):
    user_id: int
    rules: list[RankingRuleCreate]


class RankingRuleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    attribute: Optional[str] = Field(default=None, min_length=1, max_length=64)
    condition: Optional[str] = Field(default=None, min_length=1, max_length=16)
    match_value: Optional[str] = Field(default=None, min_length=0, max_length=255)
    weight: Optional[float] = Field(default=None, ge=0, le=100)
    is_active: Optional[bool] = None


class RankingRuleRead(RankingRuleBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class RSSSourceBase(BaseModel):
    user_id: int
    name: Optional[str] = None
    url: str = Field(min_length=1)
    is_active: bool = True


class RSSSourceCreate(RSSSourceBase):
    pass


class RSSSourceUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    is_active: Optional[bool] = None
    last_fetched_at: Optional[datetime] = None


class RSSSourceRead(RSSSourceBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    last_fetched_at: Optional[datetime]


class ResumeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    file_name: str
    content_type: Optional[str]
    size_bytes: int
    file_hash: str
    is_selected: bool
    created_at: datetime


class JobWeightPromptCreate(BaseModel):
    prompt: str = Field(min_length=1)
    is_enabled: bool = True


class JobWeightPromptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    prompt: str
    is_enabled: bool
    created_at: datetime


class JobWeightPromptUpdate(BaseModel):
    is_enabled: Optional[bool] = None


class JobBase(BaseModel):
    user_id: int
    rss_source_id: Optional[int] = None
    resume_id: Optional[int] = None
    ranking_rule_id: Optional[int] = None

    title: str = Field(min_length=1, max_length=255)
    company: Optional[str] = None
    location: Optional[str] = None
    url: Optional[str] = None
    description: Optional[str] = None

    status: JobStatus = JobStatus.saved
    rank_score: float = 0.0
    applied_at: Optional[datetime] = None
    is_tracked: bool = False


class JobCreate(JobBase):
    pass


class JobUpdate(BaseModel):
    rss_source_id: Optional[int] = None
    resume_id: Optional[int] = None
    ranking_rule_id: Optional[int] = None

    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    company: Optional[str] = None
    location: Optional[str] = None
    url: Optional[str] = None
    description: Optional[str] = None

    status: Optional[JobStatus] = None
    rank_score: Optional[float] = None
    applied_at: Optional[datetime] = None
    is_tracked: Optional[bool] = None


class JobRead(JobBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date_added: datetime
    updated_at: datetime

