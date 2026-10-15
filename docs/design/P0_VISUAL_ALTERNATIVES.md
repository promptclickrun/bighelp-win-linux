# P0 visual alternatives

Static desktop arrangements for Bighelp on Windows and Linux. A, B and C were the first explorations and are kept as
they were. D is the hybrid built from the parts that were picked (see [D · Hybrid](#d--hybrid-picked-structure)). None
of these is an implementation and they do not approve any dependency, renderer, font licence or brand asset.

Open `docs/design/p0-alternatives/index.html` in a browser. Each page is a single self-contained HTML file. It has a CSP
that blocks every network request, and it has no scripts, no external assets and no animation.

| File | Arrangement |
| --- | --- |
| `p0-alternatives/a-sidebar.html` | **A · Sidebar desk.** Persistent, resizable sidebar. The agent's Chat/Feed/Ideas/Goals/Files are a segmented control in the chat header. |
| `p0-alternatives/b-stage.html` | **B · Agent stage.** No permanent sidebar. A large agent avatar leads, ☰ slides the menu over the chat, the tab bar sits below the message box, and Settings opens as a sheet. |
| `p0-alternatives/c-rail.html` | **C · Rail and list.** A labelled place rail, then a chat list with pinned agents, then the conversation. Settings gets its own section column. |
| `p0-alternatives/d-hybrid.html` | **D · Hybrid.** C's labelled rail chooses the list beside it (Chats, Agents, or a function's own list). B's Chat/Feed/Ideas/Goals/Files bar sits below the message box for the open agent. |
| `p0-alternatives/source/` | `build.py`, `mock.css` and the D-only `d-hybrid.css`. These regenerate all five HTML files: `python3 source/build.py <out-dir>` (stdlib only). |

## What every alternative shows

A, B and C use the same tokens, synthetic content and states, so only the arrangement differs.

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

## D · Hybrid (picked structure)

The pick was: "I prefer the pinned menu to be on the bottom like in mockup B. But I prefer the nav rail and separate
chat/agent/function list of mockup C." D reads "pinned menu" as B's agent tab bar under the message box.

- **One global navigation.** The rail is the only place list: Chats, Agents, then Projects, Kanban, Workflows,
  Scheduled, Usage, with Vault, the host status and the one Settings at the foot. It decides what the list column shows.
- **Context list.** Chats shows recent conversations with search and new chat. Agents shows the agents on the host.
  A function such as Workflows shows its own items (synthetic names, tagged as such). Settings shows its sections,
  with the Nerd Mode items under their own label.
- **Bottom tabs are the agent's, not the app's.** Chat/Feed/Ideas/Goals/Files sit below the composer and belong to the
  open agent. They do not repeat any rail item, and they are absent on function pages where no agent is open.
- **Narrow (720 wide).** The rail stays. Picking Chats gives the list the whole page; opening a chat replaces it and
  the header gets Back to Chats, so the list is always one step away.
- **States.** Wide light shows the unknown-send warning. Wide dark and both narrow frames show the host offline with
  the draft still in the box and Send waiting.
- **Placeholders.** The Workflows page body is a dashed "Static placeholder"; only the list is designed. All people,
  agents, chats and workflow names are synthetic.
- **Settings.** One Settings, Nerd Mode on. D drops the unresolved Apple-only Companion pet row. A/B/C still show it
  as they did.

What is decided and what is not is recorded in `docs/DECISIONS.md` D5. In short, the structural direction is picked.
The rail deviation from shipping navigation is accepted as part of that pick. Rendered refinements and full visual parity
are not approved.

## Grounding

- Tokens come from the pinned `docs/upstream/bighelp/DESIGN.md` (bighelp@d62a545). Light mode uses cream #FFF9F5, ink
  #1C1A19 and #F3ECE6 incoming bubbles. Dark mode uses #121110 / #1E1C1B / #292624 and cream text. Actions are lavender
  (#7B52E0 light, #C9B6FF dark). Outgoing bubbles are #7B52E0 with white text. Ember #FF8A7A is used only in chrome
  marks and the unseen dot.
- Navigation order is a proposal derived from the current iPhone/iPad menu in the pinned `DESIGN.md`.
  The exact shipping Mac sidebar order has not been captured. The old root-navigation list in
  `CHAT_INTERACTION_CONTRACT.md` is retired; current-navigation corrections take precedence.
  These mocks do not follow the BighelpMac fixture.
- Fonts follow `docs/DECISIONS.md`: Segoe UI on Windows and Noto Sans on Linux, both through CSS font stacks only.
  Nothing is bundled or downloaded.
- Settings groups follow the Catalyst Settings list. Hermes sits under Nerd Mode, as the upstream design describes.
- Keyboard hints (Ctrl+N, Ctrl+, and Ctrl+Shift+S) are proposals and have not been ratified.

## Tradeoffs

| | A · Sidebar desk | B · Agent stage | C · Rail and list |
| --- | --- | --- | --- |
| Parity with shipping | Closest to documented desktop structure; screenshot parity unverified. | iPad-derived; the overlay menu needs an explicit desktop-sidebar exception. | Needs a recorded navigation parity exception. |
| Wide use of space | The menu and recents are always visible, and the chat is still roomy. | The conversation is centred at ≤760px, which leaves a lot of empty page at 1280. | Densest. Switching chats is one click. |
| Narrow (≤900px) | The sidebar collapses behind a title-bar button, and the tabs move to their own row. | It barely changes. This is the layout's natural size. | The list folds away, so the rail must carry chat switching (unresolved). |
| Agent identity | Small orb in the header. | Large avatar. It is the strongest character moment. | Small orb, plus pinned faces in the list. |
| Settings | Replaces the main pane, while the sidebar stays. | Modal sheet over the chat. | Section column plus a detail pane. It is the most desktop-native. |
| Risk | Sidebar width and resize persistence need specifying. | A modal for Settings may be heavier than the task needs. Menu discoverability depends on ☰. | Divergent IA doubles the parity matrix work. The rail's labels are tight at 76px. |

These tradeoffs compare the original A, B and C explorations. D was built after the pick and takes C's columns with B's
bottom bar. That leaves C's narrow-chat question answered by Back to Chats, and C's parity-matrix risk remains.

The original recommendation was A because it is closest to the documented desktop structure and fits wide windows.
This is not verified shipping-app parity. B and C remain exploratory alternatives requiring recorded
exceptions, not equally compliant implementation choices. Desktop sidebar resize bounds and persistence
already have upstream guidance (`DESIGN.md:393-396`); implementations must preserve it rather than invent
new bounds. Companion pet is an unresolved Apple-only row shown in these exploratory mocks, not an
approved desktop feature. Product visuals remain gated on an explicit choice and disposition of these gaps.

## Local checks run

- `python3 source/build.py` regenerated all five files. Two runs gave identical output. A, B and C are byte-identical
  to their pre-D versions apart from the added link to D in each page's header.
- D: Python's `html.parser` parsed it. It has seven frames. Every agent chat frame has a composer followed by the tab
  bar, and the Workflows and Settings frames have no tab bar. No frame has a pet row. The offline and unknown states are
  both present, as are the placeholder tags.
- Python's `html.parser` parsed every file. Each alternative has four frames, every chat frame has a composer, and the
  Nerd Mode zone and both connection states are present.
- grep found no `http(s)` `src`/`href` references and no `@keyframes`, `animation` or `transition` rules.
- WCAG contrast was computed for the token pairs. The lowest results are white on #7B52E0 at 5.09:1 and #7B52E0 on cream
  at 4.88:1. Every text pair is ≥4.5:1.
- Each page was rendered with local headless Chrome from `file://` for layout review only. An image review found
  clipping in the settings frames, and the frame heights were fixed. D's seven frames were rendered and inspected the
  same way, and no clipping or overflow was found. The renders are scratch files, not committed
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
- D: the rail order (Chats first) is a proposal, and so is where the function lists come from. The Workflows page body,
  Feed/Ideas/Goals/Files contents and rail overflow at small window heights are not designed. Bottom-bar
  hit targets and spacing have not been checked against the shipping iPad bar.
