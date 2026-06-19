# Open Director

Open Director is a local-first creative workspace for AI video generations.

All generations are stored directly in your local project folder, just like a coding IDE.

The center of the app is not a cloud dashboard. It is your local filesystem.

## Why This Exists (Why local first matters)

Most AI video generation tools are cloud only. This is the wrong paradigm for professional content creators.

Professional content creators use local software such as PR, Davinci, or even CapCut to edit videos and use local file systems to organize their assets.

Local file system is still the most powerful creative vehicle because it allows different software to work together without they knowing each other.

That's why the best code editors and IDEs are still local after the-Cloud have been around for more than 15 years.

That's also why Obsidian is so successful.

Data are just files.

By storing all data locally, there is zero network latency when the user wants to view a video generation. There is no downtime. Users use file systems to organize and manage their assets. Cloud backup can be solved by other tools such as Dropbox or Google Drive or even git to version control their assets.

Plus, because Open Director is local. Your local coding agent such as Claude Code, Codex or OpenClaw can drive it through the MCP interface.

Sharing is also just sharing a folder/zip, instead of a URL that other people have to register an account to have any meaningful access.

Cloud-based AI video generation platforms either can't do it, can't do them all, or can't do them well. (They are all amazing platforms, with no disrespect)

Although, currently, the most powerful models are still closed and can only run in the cloud. But, we should at least have the generation artifacts locally available. Seedance 2 won't be the last powerful AI video generation model. Open Director's architecture makes it easy to integrate any future models, whether open-source or proprietary.

Own your data, own your file, and have fun.

## Security Model

Open Director is intended to run as a trusted local application.

Do not expose it directly to the public internet. The backend can read and write
files in the selected project, launch files with the OS default application,
store an API key locally, serve project files, and expose MCP and tRPC
endpoints.

## Current Status

This is an early project, expect breaking changes

## License

No license has been selected yet.

If the goal is to be genuinely open source while discouraging proprietary
closed-source forks, this project is not MIT.
