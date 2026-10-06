# Installation Guide

## Project-level installation

Create this folder in your project:

```text
.agents/skills/
```

Then copy all 10 skill folders into it.

## Windows PowerShell

From the root of this extracted package:

```powershell
New-Item -ItemType Directory -Force -Path ".\.agents\skills" | Out-Null
Get-ChildItem -Directory | Where-Object { $_.Name -match '^\d{2}-' } | ForEach-Object {
    Copy-Item $_.FullName -Destination ".\.agents\skills\$($_.Name)" -Recurse -Force
}
```

## macOS / Linux

```bash
mkdir -p .agents/skills
cp -R 0*-* .agents/skills/
```

## How to use

Start with an explicit skill call, for example:

```text
Use 02-system-design to design the architecture for this project.
Do not write implementation code yet.
```

or in Thai:

```text
ใช้ Skill 07-testing-qa สร้าง Test Strategy สำหรับ Project นี้
โดย Mapping Requirement → Acceptance Criteria → Test Case
```
