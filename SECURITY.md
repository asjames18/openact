# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Architecture Notes

1. **Declarative Blueprints First:** OpenAct uses declarative `.act.yaml` files by default so community contributions can be audited without executing arbitrary code.
2. **Local Encrypted Session Vault (`AES-256-GCM`):** Site cookies, headers, and `{{vault.*}}` secrets are stored locally in `.openact/vault.enc.json` (which is git-ignored by default). Never hardcode personal credentials, session cookies, or API keys inside `.act.yaml` files or test fixtures.

## Reporting a Vulnerability

If you discover a security vulnerability in OpenAct, please report it privately via GitHub Security Advisories on the repository rather than opening a public issue. We will respond promptly and coordinate a fix.
