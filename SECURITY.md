# Security Policy

## Supported Versions

Security fixes are provided for the latest released version and the current default branch.

## Scope

Reports are in scope when attacker-controlled failures, timing, or request volume can bypass configured retry, timeout, circuit-breaker, bulkhead, or queue limits and cause realistic resource exhaustion; leak state across policy instances or tenants; or compromise the published package.

Failures in the caller-provided operation, remote-service availability, host TLS behavior, and deliberately unbounded configuration are outside scope unless Fetch Resilience incorrectly amplifies or crosses those boundaries.

## Reporting a Vulnerability

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/mstuart/fetch-resilience/security/advisories/new). Do not open a public issue.

Include the affected version, runtime, policy configuration, reproduction steps, and impact. Do not include secrets or personal data. Remediation and disclosure will be coordinated through the private advisory.
