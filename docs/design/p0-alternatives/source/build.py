#!/usr/bin/env python3
"""Generate the P0 static desktop mock alternatives (self-contained HTML).

Usage: python3 build.py <output-dir>
Writes index.html, a-sidebar.html, b-stage.html, c-rail.html. No network, no dependencies.
"""
import sys
import pathlib
import html

OUT = pathlib.Path(sys.argv[1])

# ---------- glyphs (24-pt grid, round 2-pt strokes; stand-ins for Design/Glyphs) ----------
G = {
    "menu": '<path d="M4 7h16M4 12h16M4 17h16"/>',
    "sidebar": '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M9.5 4.5v15"/>',
    "compose": '<path d="M12 20h8"/><path d="M16.5 3.6a2.1 2.1 0 0 1 3 3L7.5 18.6 3.5 19.5l.9-4z"/>',
    "more": '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "send": '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
    "mic": '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    "chat": '<path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-5 4v-4.2A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5z"/>',
    "feed": '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    "ideas": '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.8.7 1.3 1.5 1.3 2.4h5c0-.9.5-1.7 1.3-2.4A6 6 0 0 0 12 3z"/>',
    "goals": '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    "files": '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    "agents": '<circle cx="12" cy="12" r="8.5"/><circle cx="9.5" cy="11" r=".9"/><circle cx="14.5" cy="11" r=".9"/>',
    "group": '<circle cx="9" cy="10" r="5.5"/><path d="M15.2 5.2a5.5 5.5 0 0 1 0 9.6M7 20h4M14 20h4"/>',
    "projects": '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    "kanban": '<rect x="3.5" y="4" width="4.5" height="16" rx="1.2"/><rect x="9.8" y="4" width="4.5" height="10" rx="1.2"/><rect x="16" y="4" width="4.5" height="13" rx="1.2"/>',
    "workflows": '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.5 6.5 15.6 11M8.5 17.5l7.1-4.5"/>',
    "clock": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    "usage": '<path d="M5 20V11M12 20V4.5M19 20v-6.5"/>',
    "settings": '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    "search": '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
    "down": '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
    "right": '<path d="m9.5 6 6 6-6 6"/>',
    "question": '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.9"/><circle cx="12" cy="16.8" r=".6"/>',
    "offline": '<path d="m3.5 3.5 17 17M8.6 16.2a4.8 4.8 0 0 1 6.3-.4M5.2 12.6a9.6 9.6 0 0 1 4.3-2.4M18.8 12.6a9.6 9.6 0 0 0-2.6-1.8"/><circle cx="12" cy="19.5" r=".6"/>',
    "copy": '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
    "refresh": '<path d="M19.5 11.5A7.5 7.5 0 1 0 17.3 17"/><path d="M19.5 5v6.5H13"/>',
    "tool": '<path d="M14.5 5.5a4 4 0 0 0 4.9 4.9L11 18.8a2.1 2.1 0 0 1-3-3l8.4-8.4"/>',
    "close": '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    "host": '<rect x="3.5" y="4.5" width="17" height="11.5" rx="2"/><path d="M8.5 20h7M12 16v4"/>',
    "lock": '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
    "nerd": '<path d="m4.5 7 5 5-5 5M12.5 18h7"/>',
    "user": '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    "palette": '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.6-.8 1.3-1.7-.4-1.2.4-2.3 1.6-2.3h1.6a4 4 0 0 0 4-4A8.4 8.4 0 0 0 12 3.5z"/><circle cx="8" cy="11" r=".9"/><circle cx="11" cy="7.8" r=".9"/><circle cx="15.2" cy="8.6" r=".9"/>',
    "bell": '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5h4"/>',
    "shield": '<path d="M12 3.5 19.5 6v6c0 4.6-3.2 7.6-7.5 8.5-4.3-.9-7.5-3.9-7.5-8.5V6z"/>',
    "pet": '<circle cx="12" cy="14" r="5.5"/><circle cx="6.5" cy="7.5" r="2"/><circle cx="17.5" cy="7.5" r="2"/>',
    "check": '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    "attach": '<path d="M19 11.5 12 18.5a4.6 4.6 0 0 1-6.5-6.5l7.3-7.3a3 3 0 0 1 4.3 4.3l-7.2 7.2a1.5 1.5 0 0 1-2.1-2.1L14.5 7.5"/>',
}


def ic(name, cls="ic"):
    return (f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" '
            f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{G[name]}</svg>')


# Placeholder for the Noodle: one continuous Ember stroke writing a lowercase b with a bubble-tail kick.
# NOT the kit asset; the real Noodle must come from the licensed brand kit.
NOODLE = ('<svg class="noodle" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#FF8A7A" stroke-width="2.4" '
          'stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 3v13.5c0 2.6 1.7 4 4 4 2.6 0 4.5-1.9 4.5-4.6 '
          '0-2.6-1.8-4.4-4.2-4.4-2 0-3.5 1.2-4.3 2.6M8.5 18.5 5 21.5"/></svg>')


def wordmark():
    return f'<span class="wordmark">{NOODLE}<span>ighelp</span></span>'


AGENTS = {
    "juniper": ("Juniper", "#2BA59A"),
    "otto": ("Otto", "#4A7BEA"),
    "marigold": ("Marigold", "#E39A2D"),
}


def orb(agent, size=32):
    _, color = AGENTS[agent]
    return (f'<span class="orb" style="--orb:{color};--s:{size}px" aria-hidden="true">'
            f'<i></i><i></i></span>')


def esc(s):
    return html.escape(s, quote=True)


# ---------- window chrome (approximations, not OS screenshots) ----------
def titlebar(os_name, sidebar_button=False, title="bighelp"):
    if os_name == "windows":
        sb = (f'<button class="tb-btn" aria-label="Show sidebar (Ctrl+Shift+S)" title="Show sidebar (Ctrl+Shift+S)">'
              f'{ic("sidebar")}</button>') if sidebar_button else ""
        return (f'<header class="titlebar win11">'
                f'<span class="tb-app">{NOODLE}<span>{esc(title)}</span></span>{sb}'
                f'<span class="tb-fill"></span>'
                f'<span class="caps" aria-hidden="true"><i class="cap-min"></i><i class="cap-max"></i><i class="cap-close"></i></span>'
                f'</header>')
    sb = (f'<button class="tb-btn" aria-label="Show sidebar (Ctrl+Shift+S)" title="Show sidebar (Ctrl+Shift+S)">'
          f'{ic("sidebar")}</button>') if sidebar_button else '<span class="tb-gap"></span>'
    return (f'<header class="titlebar gnome">{sb}'
            f'<span class="tb-title">{esc(title)}</span>'
            f'<span class="gn-caps" aria-hidden="true"><i>{ic("down")}</i><i><b></b></i><i>{ic("close")}</i></span>'
            f'</header>')


# ---------- shared content ----------
NAV = [("agents", "Agents"), ("projects", "Projects"), ("kanban", "Kanban"), ("workflows", "Workflows"),
       ("clock", "Scheduled tasks"), ("usage", "Usage"), ("settings", "Settings")]

RECENTS = [
    ("juniper", "Planning call checklist", "Yes, add the first two."),
    ("otto", "Projector options", "Two rentals are near the venue."),
    ("marigold", "Weekly groceries", "List saved to Files."),
    ("juniper", "Draft agenda for the 24th", "Here's a shorter version."),
    ("otto", "Trip ideas", "You asked for three, not five."),
]


def host_row(state):
    offline = state == "offline"
    dot = '<span class="dot off" aria-hidden="true"></span>' if offline else '<span class="dot on" aria-hidden="true"></span>'
    sub = "Offline" if offline else "Connected"
    return (f'<button class="host-row" aria-label="Computer: Home computer, {sub}. Switch computer">{dot}'
            f'<span class="host-name">Home computer<small>{sub}</small></span>{ic("down")}</button>')


def menu_nav(state, active=None, nerd=False):
    items = "".join(
        f'<a class="nav-item{" is-active" if label == active else ""}" href="#"'
        f'{" aria-current=\"page\"" if label == active else ""}>{ic(i)}<span>{label}</span>'
        f'{"<kbd>Ctrl+,</kbd>" if label == "Settings" else ""}</a>' for i, label in NAV)
    rec = "".join(
        f'<a class="recent{" is-active" if n == 0 and active is None else ""}" href="#">{orb(a, 28)}'
        f'<span><b>{esc(t)}</b><small>{esc(p)}</small></span></a>' for n, (a, t, p) in enumerate(RECENTS))
    more = (f'<a class="nav-item quiet" href="#">{ic("lock")}<span>Secure vault</span></a>'
            + (f'<a class="nav-item quiet nerd-only" href="#">{ic("nerd")}<span>Hermes folder</span><em class="nerd-tag">Nerd Mode</em></a>' if nerd else ""))
    return (f'{host_row(state)}'
            f'<div class="newrow"><button class="btn-primary">{ic("compose")}New chat<kbd>Ctrl+N</kbd></button>'
            f'<button class="btn-icon" aria-label="New group chat" title="New group chat">{ic("group")}</button></div>'
            f'<nav class="nav" aria-label="Places">{items}</nav>'
            f'<div class="caption-row"><span class="caption">Recent chats</span><a href="#" class="link">See all</a></div>'
            f'<div class="recents">{rec}</div>'
            f'<div class="caption-row"><span class="caption">More</span></div><div class="more">{more}</div>')


TABS = [("chat", "Chat"), ("feed", "Feed"), ("ideas", "Ideas"), ("goals", "Goals"), ("files", "Files")]


def tabs(cls="tabs", active="Chat", dot=None):
    return (f'<nav class="{cls}" aria-label="Juniper">' + "".join(
        f'<a href="#" class="tab{" is-active" if l == active else ""}"{" aria-current=\"page\"" if l == active else ""}>'
        f'{ic(i)}<span>{l}</span>{"<i class=\"unseen\" aria-label=\"new\"></i>" if l == dot else ""}</a>'
        for i, l in TABS) + '</nav>')


def transcript(state):
    last = ""
    if state == "unknown":
        last = (f'<div class="msg out"><div class="bubble">Yes, add the first two.</div>'
                f'<div class="send-status" role="status">{ic("question", "ic st")}'
                f'<div><p><b>Not sure this arrived.</b> The connection dropped before Hermes confirmed it.</p>'
                f'<div class="st-actions"><button class="btn-soft">{ic("refresh")}Check chat history</button>'
                f'<button class="btn-quiet">{ic("copy")}Copy text</button>'
                f'<button class="btn-quiet">Send again…</button></div>'
                f'<p class="fine">Sending again could add the goals twice. Checking is safe.</p></div></div></div>')
    else:
        last = ('<div class="msg out"><div class="bubble">Yes, add the first two.</div></div>'
                '<div class="msg in"><div class="bubble">Added both under <b>Productivity</b> in Goals. '
                'I left the projector off the list.</div></div>')
    return (
        '<div class="day">Today</div>'
        '<div class="msg out"><div class="bubble">Can you turn my notes from Tuesday\'s planning call into a short checklist?</div></div>'
        f'<div class="tool-row"><button aria-expanded="false">{ic("tool")}<span>Read a file</span>'
        f'<code>notes/planning-call.md</code>{ic("right", "ic chev")}</button></div>'
        '<div class="msg in"><div class="bubble"><p>Here\'s what your notes ask for:</p><ul class="check">'
        '<li>Confirm the venue for the 24th</li><li>Send the draft agenda to Sam</li><li>Book a projector</li></ul>'
        '<p>Want any of these in Goals? Nothing is tracked until you say so.</p></div></div>'
        + last)


def offline_banner():
    return (f'<div class="conn-banner" role="status">{ic("offline", "ic st")}'
            f'<p><b>Home computer isn\'t answering.</b> You\'re seeing the copy saved on this device. Your draft stays here.</p>'
            f'<button class="btn-soft">{ic("refresh")}Try now</button></div>')


def composer(state, extra_cls=""):
    off = state == "offline"
    draft = "Also remind me about the projector on Monday" if off else ""
    dis = ' disabled aria-disabled="true"' if off else ""
    hint = ('<p class="composer-hint" id="send-hint">Send waits until Home computer is back.</p>' if off else "")
    send_state = "is-disabled" if off else ("is-ready" if draft else "is-empty")
    return (f'<form class="composer {extra_cls}" onsubmit="return false" aria-label="Message box">'
            f'<div class="box">'
            f'<button type="button" class="c-btn" aria-label="Add photos or files"{dis}>{ic("plus")}</button>'
            f'<textarea rows="1" aria-label="Message Juniper" placeholder="Message Juniper"'
            f'{" aria-describedby=\"send-hint\"" if off else ""}>{esc(draft)}</textarea>'
            f'<button type="button" class="c-btn" aria-label="Voice"{dis}>{ic("mic")}</button>'
            f'<button type="button" class="send {send_state}" aria-label="Send"{dis}>{ic("send")}</button>'
            f'</div>{hint}</form>')


def subline(state):
    return {"offline": "Offline · saved copy", "unknown": "Bot Chat · Home computer"}.get(state, "Bot Chat · Home computer")


SETTINGS_ROWS = [
    [("user", "Alex", "Your name and picture"), ("agents", "Assistants", "Default model, providers, personalities")],
    [("palette", "Appearance", "Light, dark, bubble color, page color"), ("chat", "Chat", "When bighelp opens, replies, reactions"),
     ("mic", "Voice", "Dictation and spoken replies"), ("bell", "Notifications", "Tray and alerts while bighelp runs")],
    [("host", "Hosts", "Home computer"), ("shield", "Permissions", "What agents may use on this PC"),
     ("pet", "Companion pet", "Off"), ("question", "Help & feedback", "Version, guides, report a problem")],
]


def settings_list(variant):
    groups = "".join('<ul class="set-group">' + "".join(
        f'<li><a href="#" class="set-row">{ic(i, "ic set-ic")}<span><b>{esc(t)}</b><small>{esc(s)}</small></span>{ic("right", "ic chev")}</a></li>'
        for i, t, s in g) + '</ul>' for g in SETTINGS_ROWS)
    nerd_switch = ('<ul class="set-group"><li><label class="set-row switch-row">'
                   f'{ic("nerd", "ic set-ic")}<span><b>Nerd Mode</b><small>Show host tools, logs and technical detail</small></span>'
                   '<input type="checkbox" role="switch" checked aria-describedby="nerd-note"><i class="switch" aria-hidden="true"></i></label></li></ul>')
    hermes = ('<section class="nerd-zone" aria-labelledby="hermes-h">'
              f'<header><h3 id="hermes-h">{ic("nerd")}Hermes</h3><span class="nerd-tag">Nerd Mode</span></header>'
              '<p id="nerd-note" class="fine">Only here while Nerd Mode is on. Everyday settings above never move.</p>'
              '<ul class="set-group mono-zone">'
              f'<li><a href="#" class="set-row">{ic("refresh", "ic set-ic")}<span><b>System</b><small>Update Hermes, restart the gateway, plugin version</small></span>{ic("right", "ic chev")}</a></li>'
              f'<li><a href="#" class="set-row">{ic("tool", "ic set-ic")}<span><b>Hermes tools</b><small>Search this computer\'s tools</small></span>{ic("right", "ic chev")}</a></li>'
              '</ul></section>')
    return f'<div class="settings settings-{variant}">{groups}{nerd_switch}{hermes}</div>'


# ---------- alternative A: persistent sidebar (Catalyst Mac structure) ----------
def alt_a(theme, os_name, width, height, state, view):
    narrow = width < 900
    side = f'<aside class="a-side" aria-label="Menu">{menu_nav(state, "Settings" if view == "settings" else None, nerd=view == "settings")}</aside>'
    if view == "settings":
        main = (f'<main class="a-main"><div class="page-head"><h2>Settings</h2>'
                f'<button class="btn-icon" aria-label="Close settings (Esc)">{ic("close")}</button></div>'
                f'<div class="scroll">{settings_list("a")}</div></main>')
    else:
        banner = offline_banner() if state == "offline" else ""
        main = (f'<main class="a-main"><div class="chat-head">{orb("juniper", 36)}'
                f'<div class="who"><b>Juniper</b><small>{subline(state)}</small></div>'
                f'{tabs("tabs seg")}<span class="fill"></span>'
                f'<button class="btn-icon" aria-label="New chat with Juniper">{ic("compose")}</button>'
                f'<button class="btn-icon" aria-label="Chat menu">{ic("more")}</button></div>'
                f'{tabs("tabs seg-row")}{banner}'
                f'<div class="scroll transcript">{transcript(state)}</div>{composer(state)}</main>')
    return (f'{titlebar(os_name, sidebar_button=True)}'
            f'<div class="a-body">{side}<div class="a-handle" role="separator" aria-orientation="vertical" '
            f'aria-label="Resize sidebar" tabindex="0"></div>{main}</div>')


# ---------- alternative B: agent stage, menu slides in (shared iPad structure) ----------
def alt_b(theme, os_name, width, height, state, view):
    head = (f'<div class="b-head"><button class="btn-icon" aria-label="Menu" aria-expanded="{str(view == "menu").lower()}">{ic("menu")}</button>'
            f'<div class="b-stage">{orb("juniper", 64)}<button class="b-name">Juniper{ic("down")}</button>'
            f'<small>{subline(state)}</small></div>'
            f'<span class="b-right"><button class="btn-icon" aria-label="New chat with Juniper">{ic("compose")}</button>'
            f'<button class="btn-icon" aria-label="Chat menu">{ic("more")}</button></span></div>')
    banner = offline_banner() if state == "offline" else ""
    chat = (f'<main class="b-main">{head}{banner}<div class="scroll transcript b-col">{transcript(state)}</div>'
            f'{composer(state, "b-col")}{tabs("tabs bar", dot="Feed")}</main>')
    overlay = ""
    if view == "menu":
        overlay = (f'<div class="scrim" aria-hidden="true"></div><aside class="b-menu" aria-label="Menu" role="dialog" aria-modal="true">'
                   f'<div class="b-menu-top">{wordmark()}<button class="btn-icon" aria-label="Close menu (Esc)">{ic("close")}</button></div>'
                   f'{menu_nav(state)}</aside>')
    if view == "settings":
        overlay = (f'<div class="scrim" aria-hidden="true"></div><section class="b-sheet" role="dialog" aria-modal="true" aria-labelledby="b-set-h">'
                   f'<div class="page-head"><h2 id="b-set-h">Settings</h2><button class="btn-text">Done</button></div>'
                   f'<div class="scroll">{settings_list("b")}</div></section>')
    return f'{titlebar(os_name)}<div class="b-body">{chat}{overlay}</div>'


# ---------- alternative C: place rail + chat list + chat (desktop-native divergence) ----------
RAIL = [("chat", "Chats"), ("agents", "Agents"), ("projects", "Projects"), ("kanban", "Kanban"),
        ("workflows", "Workflows"), ("clock", "Scheduled"), ("usage", "Usage")]


def alt_c(theme, os_name, width, height, state, view):
    active = "Settings" if view == "settings" else "Chats"
    rail = (f'<nav class="c-rail" aria-label="Places"><span class="c-mark">{NOODLE}</span>' + "".join(
        f'<a href="#" class="rail-item{" is-active" if l == active else ""}"{" aria-current=\"page\"" if l == active else ""}>{ic(i)}<span>{l}</span></a>'
        for i, l in RAIL) + '<span class="fill"></span>'
        f'<a href="#" class="rail-item host{" off" if state == "offline" else ""}" title="Home computer · {"Offline" if state == "offline" else "Connected"}">'
        f'{ic("host")}<i class="dot {"off" if state == "offline" else "on"}"></i><span>Home</span></a>'
        f'<a href="#" class="rail-item{" is-active" if active == "Settings" else ""}">{ic("settings")}<span>Settings</span></a></nav>')
    if view == "settings":
        sections = ["You", "Assistants", "Appearance", "Chat", "Voice", "Notifications", "Hosts", "Permissions",
                    "Companion pet", "Help & feedback"]
        col = (f'<section class="c-list" aria-label="Settings sections"><div class="c-list-head"><h2>Settings</h2></div>'
               + "".join(f'<a href="#" class="c-sec{" is-active" if s == "Appearance" else ""}">{esc(s)}</a>' for s in sections)
               + '<div class="c-nerd"><span class="nerd-tag">Nerd Mode</span><a href="#" class="c-sec">System</a><a href="#" class="c-sec">Hermes tools</a></div></section>')
        main = (f'<main class="c-main"><div class="page-head"><h2>Settings</h2></div>'
                f'<div class="scroll">{settings_list("c")}</div></main>')
        return f'{titlebar(os_name)}<div class="c-body is-settings">{rail}{col}{main}</div>'
    faces = "".join(f'<a href="#" class="face">{orb(a, 40)}<span>{AGENTS[a][0]}</span></a>' for a in AGENTS)
    rows = "".join(
        f'<a href="#" class="c-row{" is-active" if n == 0 else ""}">{orb(a, 32)}<span><b>{esc(t)}</b><small>{esc(p)}</small></span></a>'
        for n, (a, t, p) in enumerate(RECENTS))
    col = (f'<section class="c-list" aria-label="Chats"><div class="c-list-head"><h2>Chats</h2>'
           f'<button class="btn-icon" aria-label="New chat (Ctrl+N)" title="New chat (Ctrl+N)">{ic("compose")}</button></div>'
           f'<label class="search">{ic("search")}<input placeholder="Search chats" aria-label="Search chats"></label>'
           f'<div class="caption-row"><span class="caption">Pinned agents</span></div><div class="faces">{faces}</div>'
           f'<div class="caption-row"><span class="caption">Today</span></div>{rows}</section>')
    banner = offline_banner() if state == "offline" else ""
    main = (f'<main class="c-main"><div class="chat-head">{orb("juniper", 32)}'
            f'<div class="who"><b>Juniper</b><small>{subline(state)}</small></div><span class="fill"></span>'
            f'<button class="btn-icon" aria-label="Chat menu">{ic("more")}</button></div>'
            f'{tabs("tabs line")}{banner}<div class="scroll transcript">{transcript(state)}</div>{composer(state)}</main>')
    return f'{titlebar(os_name)}<div class="c-body">{rail}{col}{main}</div>'


# ---------- frames ----------
def frame(builder, theme, os_name, w, h, state, view, label):
    os_label = "Windows 11 frame" if os_name == "windows" else "Ubuntu GNOME frame"
    caption = f'{w}×{h} · {theme.title()} · {os_label} (drawn approximation) · {label}'
    return (f'<figure class="frame"><figcaption>{esc(caption)}</figcaption>'
            f'<div class="win {theme} os-{os_name}" style="width:{w}px;height:{h}px">{builder(theme, os_name, w, h, state, view)}</div></figure>')


ALTS = {
    "a": dict(file="a-sidebar.html", name="A · Sidebar desk", builder=alt_a,
              thesis="Closest to shipping Catalyst on the Mac: a persistent, resizable sidebar holding the ☰ menu, "
                     "the agent's Chat/Feed/Ideas/Goals/Files as a segmented control in the chat header.",
              frames=[("light", "windows", 1280, 800, "unknown", "chat", "Chat · send outcome unknown"),
                      ("dark", "windows", 1280, 800, "offline", "chat", "Chat · host offline, draft kept"),
                      ("light", "linux", 720, 1080, "unknown", "settings", "Settings · Nerd Mode on"),
                      ("dark", "linux", 720, 780, "offline", "chat", "Narrow chat · sidebar collapsed, offline")]),
    "b": dict(file="b-stage.html", name="B · Agent stage", builder=alt_b,
              thesis="The shared iPad structure on a desktop: no always-open sidebar, the agent's big avatar leads, "
                     "☰ slides the menu over the page, and the tab bar sits under the message box.",
              frames=[("light", "windows", 1280, 800, "unknown", "chat", "Chat · send outcome unknown"),
                      ("dark", "windows", 1280, 800, "offline", "chat", "Chat · host offline, draft kept"),
                      ("light", "linux", 720, 1180, "unknown", "settings", "Settings sheet · Nerd Mode on"),
                      ("dark", "linux", 720, 900, "unknown", "menu", "Narrow · ☰ menu open over chat")]),
    "c": dict(file="c-rail.html", name="C · Rail and list", builder=alt_c,
              thesis="A desktop-mail arrangement: a slim labelled rail of places, a chat list with pinned agents, "
                     "then the conversation. Diverges most from shipping structure; needs an explicit parity exception.",
              frames=[("light", "windows", 1280, 800, "unknown", "chat", "Chat · send outcome unknown"),
                      ("dark", "windows", 1280, 800, "offline", "chat", "Chat · host offline, draft kept"),
                      ("light", "linux", 720, 1080, "unknown", "settings", "Settings · Nerd Mode on"),
                      ("dark", "linux", 720, 780, "unknown", "chat", "Narrow chat · list folds away")]),
}

CSS = (pathlib.Path(__file__).parent / "mock.css").read_text()

CONTRACT = """<!--
THESIS: Bighelp on Windows/Linux is the shipping Catalyst app's world (cream/graphite pages, lavender actions,
Ember Noodle in chrome only) in three structural arrangements; it refuses a new identity.
OWN-WORLD: BighelpTheme tokens from DESIGN.md at bighelp@d62a545; Segoe UI / Noto Sans stacks; still status, no loaders.
STORY: a person sees one menu, one Settings, a message box that never moves, and plain words when the host is
offline or a send is unconfirmed.
FIRST VIEWPORT: per alternative, see the figure captions; the message box is pinned bottom in every frame.
FORM: extension of an established world (no concept roll); three structures for a pick, not a ranking.
Synthetic fixture content only. Not screenshots of the shipping app.
-->"""


def page(key):
    a = ALTS[key]
    others = " · ".join(f'<a href="{ALTS[k]["file"]}">{ALTS[k]["name"]}</a>' for k in ALTS if k != key)
    frames = "".join(frame(a["builder"], *f) for f in a["frames"])
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">'
            f'<title>{esc(a["name"])} — Bighelp Windows/Linux P0 mock</title><style>{CSS}</style></head>'
            f'<body class="doc">{CONTRACT}<header class="doc-head"><p class="doc-back"><a href="index.html">All alternatives</a> · {others}</p>'
            f'<h1>{esc(a["name"])}</h1><p class="doc-lede">{esc(a["thesis"])}</p>'
            f'<p class="doc-warn">Static mock with synthetic content. Window frames are drawn approximations, not OS or shipping-app screenshots. '
            f'Fonts fall back to whatever this browser has.</p></header>'
            f'<div class="frames">{frames}</div></body></html>')


def index():
    cards = "".join(
        f'<li><a href="{a["file"]}"><b>{esc(a["name"])}</b></a><p>{esc(a["thesis"])}</p></li>' for a in ALTS.values())
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">'
            f'<title>Bighelp Windows/Linux — P0 visual alternatives</title><style>{CSS}</style></head>'
            f'<body class="doc">{CONTRACT}<header class="doc-head"><h1>Bighelp for Windows and Linux: three arrangements</h1>'
            f'<p class="doc-lede">Same tokens, content and states in each. Pick an arrangement; colours, glyphs and fonts are not the question here.</p>'
            f'<p class="doc-warn">Static, synthetic, not published anywhere. Nothing here is a screenshot of the shipping app.</p></header>'
            f'<ul class="alt-list">{cards}</ul>'
            f'<section class="doc-note"><h2>Shown in every alternative</h2><ul>'
            f'<li>Light and dark; wide (1280×800, Windows frame) and narrow (720×780, GNOME frame).</li>'
            f'<li>The message box pinned under the conversation, outside the scrolling list.</li>'
            f'<li>One menu and one Settings; the Hermes section appears only with Nerd Mode on.</li>'
            f'<li>Host offline: saved copy stays readable, the draft stays, Send waits.</li>'
            f'<li>Send outcome unknown: check history first; sending again is explicit and says it could run twice.</li>'
            f'</ul></section></body></html>')


OUT.mkdir(parents=True, exist_ok=True)
for k, a in ALTS.items():
    (OUT / a["file"]).write_text(page(k))
(OUT / "index.html").write_text(index())
print("wrote", sorted(p.name for p in OUT.iterdir()))
