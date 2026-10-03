from pydantic import BaseModel
from acme_core.models import RuleAttachment

class UpdateAgentRulesRequest(BaseModel):
    attached_rules: list[RuleAttachment]