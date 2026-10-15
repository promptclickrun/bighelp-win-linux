# P0 visual alternatives

Three static desktop arrangements for Bighelp on Windows and Linux. They are here so someone can pick one. They are not
an implementation and they do not approve any dependency, renderer, font licence or brand asset.

Open `docs/design/p0-alternatives/index.html` in a browser. Each page is a single self-contained HTML file. It has a CSP
that blocks every network request, and it has no scripts, no external assets and no animation.

| File | Arrangement |
| --- | --- |
| `p0-alternatives/a-sidebar.html` | **A · Sidebar desk.** Persistent, resizable sidebar. The agent's Chat/Feed/Ideas/Goals/Files are a segmented control in the chat header. |
| `p0-alternatives/b-stage.html` | **B · Agent stage.** No permanent sidebar. A large agent avatar leads, ☰ slides the menu over the chat, the tab bar sits below the message box, and Settings opens as a sheet. |
| `p0-alternatives/c-rail.html` | **C · Rail and list.** A labelled place rail, then a chat list with pinned agents, then the conversation. Settings gets its own section column. |
| `p0-alternatives/source/` | `build.py` + `mock.css`. These regenerate the four HTML files: `python3 source/build.py <out-dir>` (stdlib only). |

## What every alternative shows

All three use the same tokens, synthetic content and states, so only the arrangement differs.

- **Frames:** light and dark. Each alternative has two wide frames (1280×800, drawn Windows 11 chrome) and two narrow
  frames (720 wide, drawn GNOME chrome). The settings frames are taller so the Nerd Mode section is visible without scrolling.
- **Persistent composer:** the message box always sits outside the scrolling transcript, pinned to the bottom of the
  conversation, and it keeps its draft in every state.
- **One navigation, one Settings:** the place list has a single order: Agents, Projects, Kanban, Workflows, Scheduled
  tasks, Usage, Settings. Recent chats come next, with See all. The Secure vault comes after that.
- **Nerd Mode separation:** the everyday Settings rows stay in the same place whether Nerd Mode is on or off. Hermes
  items (System, Hermes tools, Hermes folder) appear only inside a dashed region labelled "Nerd Mode", and only while the
  switch is on.
- **Host offline:** a banner says the host isn't answering and that this is the copy saved on this device. The draft
  stays, Send and attachments are disabled, and a line explains that Send waits. "Try now" is the only call to action.
- **Send outcome unknown:** the last outgoing bubble is marked "Not sure this arrived." The safe action, Check chat
  history, comes first. Copy text is offered too. Send again… is explicit and warns that the action could run twice. It
  never auto-retries.
- **Synthetic content:** made-up people and agents (Alex; Juniper, Otto and Marigold) and made-up notes. No real
  accounts, hosts or messages are shown.

## Grounding

- Tokens come from the pinned `docs/upstream/bighelp/DESIGN.md` (bighelp@d62a545). Light mode uses cream #FFF9F5, ink
  #1C1A19 and #F3ECE6 incoming bubbles. Dark mode uses #121110 / #1E1C1B / #292624 and cream text. Actions are lavender
  (#7B52E0 light, #C9B6FF dark). Outgoing bubbles are #7B52E0 with white text. Ember #FF8A7A is used only in chrome
  marks and the unseen dot.
- Navigation order follows the shipping Catalyst/iPad menu and the sidebar rules in
  `docs/upstream/bighelp/CHAT_INTERACTION_CONTRACT.md`. It does not follow the BighelpMac fixture.
- Fonts follow `docs/DECISIONS.md`: Segoe UI on Windows and Noto Sans on Linux, both through CSS font stacks only.
  Nothing is bundled or downloaded.
- Settings groups follow the Catalyst Settings list. Hermes sits under Nerd Mode, as the upstream design describes.
- Keyboard hints (Ctrl+N, Ctrl+, and Ctrl+Shift+S) are proposals and have not been ratified.

## Tradeoffs

| | A · Sidebar desk | B · Agent stage | C · Rail and list |
| --- | --- | --- | --- |
| Parity with shipping | Highest. It matches Catalyst on the Mac. | High. It matches the shared iPad structure. | Lowest. It needs a recorded parity exception. |
| Wide use of space | The menu and recents are always visible, and the chat is still roomy. | The conversation is centred at ≤760px, which leaves a lot of empty page at 1280. | Densest. Switching chats is one click. |
| Narrow (≤900px) | The sidebar collapses behind a title-bar button, and the tabs move to their own row. | It barely changes. This is the layout's natural size. | The list folds away, so the rail must carry chat switching (unresolved). |
| Agent identity | Small orb in the header. | Large avatar. It is the strongest character moment. | Small orb, plus pinned faces in the list. |
| Settings | Replaces the main pane, while the sidebar stays. | Modal sheet over the chat. | Section column plus a detail pane. It is the most desktop-native. |
| Risk | Sidebar width and resize persistence need specifying. | A modal for Settings may be heavier than the task needs. Menu discoverability depends on ☰. | Divergent IA doubles the parity matrix work. The rail's labels are tight at 76px. |

The recommendation is A. It keeps the shipping navigation and Settings intact and fits wide desktop windows. B is the
fallback if character matters more than visible navigation. Choose C only if the plan is changed to allow a
desktop-specific information architecture. This is a judgement for the reviewer, not a decision record.

## Local checks run

- `python3 source/build.py` regenerated all four files.
- Python's `html.parser` parsed every file. Each alternative has four frames, every chat frame has a composer, and the
  Nerd Mode zone and both connection states are present.
- grep found no `http(s)` `src`/`href` references and no `@keyframes`, `animation` or `transition` rules.
- WCAG contrast was computed for the token pairs. The lowest results are white on #7B52E0 at 5.09:1 and #7B52E0 on cream
  at 4.88:1. Every text pair is ≥4.5:1.
- Each page was rendered with local headless Chrome from `file://` for layout review only. An image review found
  clipping in the settings frames, and the frame heights were fixed. The renders are scratch files, not committed
  artifacts, and they are not screenshots of the shipping app.

## Pending evidence (not claimed)

- No screenshots of the shipping Bighelp app (Catalyst, iPad or iOS) were captured. These mocks were compared with the
  pinned text descriptions only.
- Rendering on Windows 11 and on Linux (GNOME/KDE, Wayland/X11) is unverified. The window chrome is drawn, not native,
  and real titlebar and caption-button behaviour needs Electron evidence.
- The fonts on the machine that rendered these mocks are unknown. Segoe UI and Noto Sans metrics are unverified, and so
  is the Noto licensing decision.
- The real Noodle, wordmark, AvatarKit avatars and Design/Glyphs set are not used. The orbs, glyphs and Noodle are
  hand-drawn stand-ins.
- High contrast, Windows forced-colors, reduced motion with a real motion design, 125%/150% scaling, RTL and screen
  readers were not tested.
- Keyboard focus styles are present but have not been tested in a real build.
