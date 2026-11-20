from pydantic import BaseModel, Field


class RawJob(BaseModel):
    source: str
    source_id: str | None = None
    url: str
    title: str
    company: str
    location_raw: str | None = None
    description: str | None = None
    posted_at: str | None = None


class TagResult(BaseModel):
    id: int
    role: str
    city: str
    job_type: str
    is_fresher: bool
    confidence: float = Field(ge=0, le=1)


class TagBatch(BaseModel):
    results: list[TagResult]