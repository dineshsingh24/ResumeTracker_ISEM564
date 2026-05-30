from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import feedparser
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from backend.models import Job, RankingRule


def _extract_entry_fields(entry: Any) -> Tuple[str, Optional[str], Optional[str], Optional[str]]:
    title = getattr(entry, "title", None) or ""
    url = getattr(entry, "link", None)
    description = getattr(entry, "summary", None) or getattr(entry, "description", None)
    company = getattr(entry, "author", None) or getattr(entry, "publisher", None)
    return title.strip(), (company.strip() if isinstance(company, str) else None), url, description


def _normalize_text(value: Optional[str]) -> str:
    if not value:
        return ""
    return str(value).strip().lower()


def _match_rule(*, field_value: str, condition: str, needle: str) -> bool:
    if not needle:
        return False
    if condition == "contains":
        return needle in field_value
    if condition == "excludes":
        return needle not in field_value
    return False


def _apply_ranking_rules(
    db: Session,
    *,
    user_id: int,
    title: str,
    company: Optional[str],
    description: Optional[str],
) -> float:
    base_score = 0.0

    rules: List[RankingRule] = (
        db.query(RankingRule)
        .filter(and_(RankingRule.user_id == user_id, RankingRule.is_active == True))
        .order_by(RankingRule.id.asc())
        .all()
    )

    for rule in rules:
        attribute = _normalize_text(rule.attribute)
        condition = _normalize_text(rule.condition)
        needle = _normalize_text(rule.match_value)

        if not attribute or not condition or not needle:
            continue

        if attribute == "title":
            field_value = _normalize_text(title)
        elif attribute == "company":
            field_value = _normalize_text(company)
        elif attribute == "description":
            field_value = _normalize_text(description)
        else:
            continue

        if _match_rule(field_value=field_value, condition=condition, needle=needle):
            try:
                base_score += float(rule.weight or 0.0)
            except (TypeError, ValueError):
                continue

    return base_score


def fetch_and_rank_jobs(
    db: Session,
    *,
    user_id: int,
    rss_url: str,
    rss_source_id: Optional[int] = None,
    limit: int = 25,
) -> List[Job]:
    parsed = feedparser.parse(rss_url)
    entries = list(getattr(parsed, "entries", []) or [])[: max(0, int(limit))]

    created: List[Job] = []
    now = datetime.utcnow()

    for entry in entries:
        title, company, url, description = _extract_entry_fields(entry)
        if not title:
            continue

        duplicate_query = db.query(Job).filter(Job.user_id == user_id)
        if url:
            duplicate_query = duplicate_query.filter(Job.url == url)
        else:
            duplicate_query = duplicate_query.filter(
                or_(
                    and_(Job.title == title, Job.company == company),
                    Job.title == title,
                )
            )

        existing = duplicate_query.first()
        if existing is not None:
            continue

        score = _apply_ranking_rules(
            db,
            user_id=user_id,
            title=title,
            company=company,
            description=description,
        )

        job = Job(
            user_id=user_id,
            rss_source_id=rss_source_id,
            title=title,
            company=company,
            url=url,
            description=description,
            rank_score=score,
            date_added=now,
        )
        db.add(job)
        created.append(job)

    if created:
        db.commit()
        for job in created:
            db.refresh(job)

    return created

