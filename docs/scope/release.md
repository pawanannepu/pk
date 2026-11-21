# Epic: Release

Getting pk into other developers' hands and keeping it current. Part of the [pk scope](index.md).

## Launch

### 29. Release & distribution · needs a decision
Package and publish the MVP as open source: license, README with install and provider setup, release builds for macOS and Linux, versioning, and a release pipeline.
**Done when:** a new user installs pk with one command, logs in, and completes a first task by following the README; releases are built and published by CI from a tag; the license and a clean room statement are in the repo.
- [ ] Design it (spec): `/architect release & distribution`

## Slice 11: Extensibility

### 40. Self update · needs a decision
pk checks for new releases and can install them itself.
**Done when:** pk tells the user when a new version exists without slowing startup; updating verifies the download before replacing anything; it can be turned off and never runs during headless mode.
- [ ] Design it (spec): `/architect self update`

## Deferred

Out of scope for the current build pass, kept so the plan stays honest.
- **Windows support**: Windows Credential Manager, PowerShell and path handling · needs a decision
- **Screen reader mode**: no spinners or redraws, linear output for screen reader users · needs a decision
- **Linux musl (Alpine) support**: musl builds of the binary and OpenTUI's musl native package; unsupported at launch · needs a decision · from spec 0001
