# OpenChat

OpenChat is a personal AI workspace organized around agents and their conversations.

## Language

**Auth session**:
A server-side login credential that connects one browser session to one user.
_Avoid_: Session

**Agent**:
An AI persona with its own instructions and model configuration. Phase 2 uses an implicit default agent; explicit agent management arrives later.
_Avoid_: Assistant, bot, session

**Topic**:
One conversation owned by a user, containing an ordered history of messages.
Code and database fields use “topic”; concise user-facing copy may call it a “chat.”
_Avoid_: Thread, session

**Chat**:
The user-facing activity and screen for conversing within a Topic. Do not use it as a persisted entity or identifier in code.

**Message**:
One user, assistant, or system turn within a topic.
_Avoid_: Prompt, response
