# Open Questions

Questions we need to answer to move forward. Let's discuss these!

---

## Priority: HIGH (Blocking)

### Q1: What's your primary use case?

I can design very differently depending on what you want:

**A) Coding Assistant**
- Focus on file/code operations
- Git integration
- IDE-like features
- Deep codebase understanding

**B) Life Admin / Personal Assistant**
- Calendar integration
- Reminders and tasks
- Email handling
- Information lookup

**C) Communication Hub**
- Unified inbox across platforms
- Message routing
- Auto-responses
- Contact management

**D) Automation Platform**
- Cron jobs and schedules
- Webhook handling
- Script execution
- Monitoring and alerts

**E) Something else entirely?**

_Your answer shapes the entire architecture._

---

### Q2: Where will you run this?

**A) Local machine only**
- Your laptop/desktop
- Access only when at that machine
- Maximum privacy

**B) Home server**
- Raspberry Pi, NAS, old laptop
- Always on at home
- Remote access via Tailscale/VPN

**C) Cloud VPS**
- Hetzner, DigitalOcean, etc.
- Always accessible
- Monthly cost (~$5-20)

**D) Combination**
- Local for dev, VPS for production
- Or other hybrid approach

---

### Q3: Which messaging platforms do you actually use?

Check all that apply:
- [ ] Telegram
- [ ] WhatsApp
- [ ] Discord
- [ ] Slack
- [ ] Signal
- [ ] iMessage (macOS only)
- [ ] SMS
- [ ] Email
- [ ] Other: _______

_We'll prioritize based on what you actually use._

---

### Q4: What's your comfort level with self-hosting?

**A) Expert** - I run my own servers, comfortable with Docker, networking, etc.

**B) Intermediate** - I can follow guides, debug basic issues

**C) Beginner** - I want something that "just works"

_This affects how much automation/hand-holding we build in._

---

## Priority: MEDIUM (Important but not blocking)

### Q5: Do you want voice capabilities?

- Wake word detection ("Hey assistant")
- Voice input (speech-to-text)
- Voice output (text-to-speech)
- Phone call handling

_Adds significant complexity but can be very useful._

---

### Q6: What tools should the AI have access to?

**Core (always):**
- [ ] Read files
- [ ] Write files
- [ ] Execute commands (sandboxed)
- [ ] Web search/fetch

**Extended:**
- [ ] Browser automation
- [ ] Git operations
- [ ] Database queries
- [ ] API calls
- [ ] Send messages
- [ ] Calendar/email
- [ ] Smart home
- [ ] Custom tools: _______

---

### Q7: How much should the AI do autonomously?

**A) Ask before everything**
- Maximum control
- Can be tedious

**B) Ask for dangerous operations only**
- Balance of convenience and safety
- Needs clear "dangerous" definition

**C) Just do it (with logging)**
- Maximum convenience
- Trust the AI
- Requires good guardrails

---

### Q8: Multi-user or single user?

**A) Just me**
- Simpler auth
- No permission system needed
- All data is mine

**B) Me + family/friends**
- Need user separation
- Different permission levels
- Session isolation

**C) Team/work use**
- Full multi-tenancy
- Admin controls
- Audit logging

---

## Priority: LOW (Can decide later)

### Q9: UI preferences?

- CLI only (terminal)
- Web dashboard
- Native app (Electron/Tauri)
- Mobile app
- All of the above

---

### Q10: Observability needs?

- Basic logging (console)
- File logging
- Structured logging (JSON)
- Metrics (Prometheus)
- Tracing (OpenTelemetry)
- Dashboard (Grafana)

---

### Q11: Backup strategy?

- Manual exports
- Automated backups
- Cloud sync
- Version control for config

---

## Your Questions

_Add any questions you have for me here:_

1.
2.
3.

---

## Answered Questions

_(Move questions here once we've decided)_

---

*Let's work through these together!*
