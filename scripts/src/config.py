#!/usr/bin/env python3
"""Runtime configuration for the recording receiver."""

import json
from pathlib import Path


RECEIVER = {
    "host": "127.0.0.1",
    "port": 4317,
    "recordingsRoot": str(Path.home() / "Documents" / "thoughts" / "recordings"),
    "maxUploadBytes": 250 * 1024 * 1024,
    "uniqueNameAttempts": 10_000,
    "uploadFileMode": 0o600,
    "healthPath": "/health",
    "recordingsPath": "/recordings",
    "notesListPath": "/notes",
    "noteDaysPath": "/notes/days",
    "featuredNotePath": "/notes/rec-16-32",
    "noteStatusPath": "/notes/status",
    "noteRetryPath": "/notes/retry",
    "dailySummaryPath": "/daily",
    "featuredRecordingRelativePath": "15-07-2026/rec-16-32",
    "featuredRecordingLocationLabel": "Berlin, Hansaviertel",
    "openClawHookUrl": "http://127.0.0.1:19789/hooks/agent",
    "hookRetryDelaysMs": [0, 5_000, 30_000, 120_000, 300_000],
    "hookRequestTimeoutMs": 10_000,
    "hookAgentTimeoutSeconds": 15 * 60,
    "processingTimeoutMs": 20 * 60 * 1000,
    "hookAgentId": "main",
    "hookName": "New voice thought",
}


if __name__ == "__main__":
    print(json.dumps(RECEIVER))
