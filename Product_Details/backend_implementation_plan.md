# Backend Implementation Plan - M1 (Backend Engineer)

**BYO-LLM Orchestrator** | Your Role: Backend & Orchestration Engineer | Total Time: ~30 Hours

---

## 🎯 Your Critical Path Overview

**You are the foundation.** M2 (Frontend) and M3 (Integration) both depend on your endpoints. Build in this exact order.

```
Hour 0-1:  Project Setup
    ↓
Hour 1-3:  API Key Vault (DEP: M2 can start UI)
    ↓
Hour 3-7:  Router Brain (DEP: M2 can show plan preview)
    ↓
Hour 7-14: Execution Engine (DEP: M2 can show execution)
    ↓
Hour 14-17: Analytics + Fallback (DEP: M3 integration)
    ↓
Hour 17-20: Integration QA (DEP: Full system test)
```

---

## 📋 Phase-by-Phase Breakdown

### **PHASE 1: Project Setup & Environment (Hour 0-1)**
**Priority: 🔴 HIGHEST** | **Dependencies: None** | **Team Impact: None**

**What to do first:**

1. **Create backend project structure**
   ```bash
   mkdir backend && cd backend
   npm init -y
   npm install express openai @anthropic-ai/sdk @google/generative-ai
   npm install @supabase/supabase-js dotenv crypto-js
   npm install zod cors helmet express-rate-limit
   ```

2. **Create folder structure**
   ```
   backend/
   ├── index.js (main entry)
   ├── routes/
   │   ├── keys.js
   │   ├── plan.js
   │   └── execute.js
   ├── core/
   │   ├── router.js
   │   ├── executor.js
   │   ├── classifier.js
   │   └── token_counter.js
   ├── security/
   │   └── vault.js
   ├── db/
   │   └── supabase.js
   └── .env
   ```

3. **Create .env file**
   ```env
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_KEY=eyJhbGciOiJ...
   ENCRYPTION_KEY=hackathon_secret_key_32chars_xx
   PORT=8000
   ```

4. **Write index.js (main entry point)**
   - Express app with CORS enabled
   - Include all route modules
   - Start server on port 8000
   - Test: `node index.js` → visit `http://localhost:8000`

5. **Write db/supabase.js**
   - Initialize Supabase client
   - Export for use across all modules

**✅ Checkpoint:**
- Server starts without errors
- All folders exist
- .env in .gitignore
- Swagger UI accessible at /docs

**🔗 Team Handoff:**
- None (you're setting up foundation)

---

### **PHASE 2: API Key Vault (Hour 1-3)**
**Priority: 🔴 HIGHEST** | **Dependencies: Phase 1** | **Team Impact: M2 can start building UI**

**What to do right:**

1. **Database is already created** ✅ (we did this earlier)
   - Tables: `users`, `sessions`, `api_key_vault`, `model_registry`
   - Row Level Security enabled
   - 13 models pre-populated

2. **Write security/vault.js**
   - AES-256-GCM encryption
   - `encryptKey(plaintext)` → returns encrypted string
   - `decryptKey(encrypted)` → returns plaintext
   - **RULE:** Decrypted key lives in memory <50ms, never logged

3. **Write routes/keys.js**
   - POST `/api/keys` - Validate → Encrypt → Store
   - GET `/api/models` - Return available models for session
   - Validate key with cheap API call before storing
   - **CRITICAL:** Never return key in response

4. **Test key submission**
   - Submit real OpenAI key
   - Check Supabase: encrypted_key should be ciphertext
   - Test GET /api/models returns correct list

**✅ Checkpoint:**
- POST /api/keys works with real key
- GET /api/models returns available models
- Keys encrypted in DB (no plain text)
- No keys in logs or responses

**🔗 Team Handoff:**
- **Tell M2:** "Keys API is live, start building Screen 1 (API Key Connection)"
- M2 can now build the key submission UI

---

### **PHASE 3: Router LLM Brain (Hour 3-7)**
**Priority: 🔴 HIGHEST** | **Dependencies: Phase 2** | **Team Impact: M2 can show plan preview**

**What to do right:**

1. **Write core/router.js**
   - System prompt engineering (spend time here!)
   - Call LLM with prompt + availableModels
   - Force JSON output format
   - Validate all assigned models are in available list

2. **Router System Prompt Strategy:**
   ```
   You are an AI orchestration router.
   Available models: {availableModels}
   User prompt: {userPrompt}
   
   Return ONLY JSON:
   {
     "category": "research|coding|logic|creative|planning|math|general",
     "difficulty": "easy|medium|hard|agentic",
     "needsDecomposition": true|false,
     "subtasks": [
       {
         "id": 1,
         "title": "task description",
         "assignedModel": "from availableModels only",
         "prompt": "sub-prompt"
       }
     ]
   }
   ```

3. **Write routes/plan.js**
   - POST `/api/plan`
   - Call router to generate plan
   - Add token/cost estimates (coordinate with M3)
   - Return plan in contract format

4. **Test plan generation**
   - Submit: "Build a market research report"
   - Verify: Returns JSON with subtasks
   - Verify: All models are from available list
   - Verify: Token/cost estimates populated

**✅ Checkpoint:**
- POST /api/plan returns valid JSON
- Router only uses models from available list
- Token/cost fields populated
- Plan matches contract format

**🔗 Team Handoff:**
- **Tell M2:** "Plan API is live, start building Screen 2 (Prompt + Plan Preview)"
- **Tell M3:** "Need token_counter module for cost estimates"
- M2 can now show the impressive plan preview UI

---

### **PHASE 4: Execution Engine (Hour 7-14)**
**Priority: 🔴 HIGHEST** | **Dependencies: Phase 3** | **Team Impact: M2 can show execution results**

**What to do right:**

1. **Write core/executor.js**
   - Execute each subtask sequentially
   - Decrypt key → Call LLM → Stream output
   - Handle failures with fallback
   - Track tokens, cost, latency

2. **Fallback Logic:**
   - Try assigned model first
   - On failure (429, 5xx, timeout): try next available
   - Log fallback events
   - Max 2 fallback attempts per subtask

3. **Write routes/execute.js**
   - POST `/api/execute`
   - Execute approved plan
   - Return results in contract format
   - Include analytics data

4. **Test execution**
   - Submit simple prompt
   - Verify: All subtasks complete
   - Verify: Fallback works (disable one key)
   - Verify: Final merged output returned

**✅ Checkpoint:**
- POST /api/execute runs all subtasks
- Fallback works on model failure
- Final merged output returned
- Analytics data (tokens, cost, latency) present

**🔗 Team Handoff:**
- **Tell M2:** "Execute API is live, start building Screen 3 (Execution + Results)"
- **Tell M3:** "Need analytics module for tracking"
- M2 can now show the full execution flow

---

### **PHASE 5: Analytics + Fallback (Hour 14-17)**
**Priority: 🟡 MEDIUM** | **Dependencies: Phase 4** | **Team Impact: M3 integration**

**What to do right:**

1. **Write db/analytics.js** (Coordinate with M3)
   - `upsert_model_usage_stats()` - Daily rollup
   - `check_daily_spend_cap()` - Enforce limits
   - Log execution to audit_logs table

2. **Add confidence scoring** (Coordinate with M3)
   - After each subtask, call scorer LLM
   - Score 0-100 with rationale
   - Store in confidence_scores table

3. **Implement rate limiting**
   - `express-rate-limit` on /api/plan (60/min)
   - `express-rate-limit` on /api/execute (10/min)

4. **Test analytics**
   - Execute multiple prompts
   - Verify: model_usage_stats updated
   - Verify: audit_logs populated
   - Verify: confidence scores saved

**✅ Checkpoint:**
- Analytics tracking works
- Daily rollup updates correctly
- Confidence scores saved
- Rate limiting enforced

**🔗 Team Handoff:**
- **Tell M3:** "Analytics ready, integrate with your modules"
- **Tell M2:** "Analytics data available for dashboard"

---

### **PHASE 6: Integration QA (Hour 17-20)**
**Priority: 🟡 MEDIUM** | **Dependencies: Phase 5** | **Team Impact: Full system test**

**What to do right:**

1. **End-to-end testing**
   - Test full flow: Key → Plan → Execute → Results
   - Test with multiple providers
   - Test fallback scenarios
   - Test edge cases

2. **Security audit**
   - Verify no keys in logs
   - Verify RLS policies working
   - Verify encryption/decryption correct
   - Check for any data leaks

3. **Performance testing**
   - Test with long prompts
   - Test with many subtasks
   - Measure response times
   - Optimize if needed

4. **Documentation**
   - Update API documentation
   - Document security rules
   - Create troubleshooting guide

**✅ Checkpoint:**
- Full system works end-to-end
- Security audit passed
- Performance acceptable
- Documentation complete

**🔗 Team Handoff:**
- **Tell Team:** "Backend ready for final integration"
- **Tell M2:** "All endpoints tested and documented"
- **Tell M3:** "Analytics integration complete"

---

## 🚨 Critical Dependencies & Interconnections

### **Your Dependencies on Others:**

1. **M3 (Integration Engineer):**
   - Token counting logic (core/token_counter.js)
   - Analytics tracking (db/analytics.js)
   - Confidence scoring module

2. **Supabase:**
   - Database already created ✅
   - Tables: users, sessions, api_key_vault, model_registry, executions, etc.
   - 13 models pre-populated ✅

### **Others' Dependencies on You:**

1. **M2 (Frontend Engineer):**
   - **Hour 1-3:** Needs POST /api/keys, GET /api/models → Can build Screen 1
   - **Hour 3-7:** Needs POST /api/plan → Can build Screen 2
   - **Hour 7-14:** Needs POST /api/execute → Can build Screen 3
   - **Hour 14+:** Needs analytics data → Can build dashboard

2. **M3 (Integration Engineer):**
   - **Hour 3-7:** Needs token_counter for cost estimates
   - **Hour 14-17:** Needs analytics integration
   - **Hour 17-20:** Needs full system for QA

---

## 📊 Timeline Summary

| Phase | Hours | What You Do | Who Depends | Handoff To |
|-------|-------|-------------|-------------|------------|
| 1. Setup | 0-1 | Project structure, env, server | None | None |
| 2. Key Vault | 1-3 | Encryption, key validation | M2 | M2 (Screen 1) |
| 3. Router | 3-7 | Plan generation, routing | M2, M3 | M2 (Screen 2), M3 (token_counter) |
| 4. Execution | 7-14 | Subtask execution, fallback | M2, M3 | M2 (Screen 3), M3 (analytics) |
| 5. Analytics | 14-17 | Tracking, scoring, rate limiting | M3 | M3 (integration) |
| 6. QA | 17-20 | E2E testing, security audit | All | All (final) |

---

## 🎯 Priority Order (Do NOT Skip)

1. **FIRST:** Phase 1 (Setup) - Foundation
2. **SECOND:** Phase 2 (Key Vault) - Security foundation
3. **THIRD:** Phase 3 (Router) - Core intelligence
4. **FOURTH:** Phase 4 (Execution) - Main functionality
5. **FIFTH:** Phase 5 (Analytics) - Enhanced features
6. **SIXTH:** Phase 6 (QA) - Final polish

---

## 🔑 Key Rules to Remember

### **Security Rules (Non-negotiable):**
- 🔴 API keys NEVER leave backend
- 🔴 Keys encrypted before DB storage
- 🔴 Keys decrypted only milliseconds before LLM call
- 🔴 Never return keys in responses
- 🔴 Never log keys anywhere

### **Team Coordination:**
- ✅ Tell M2 when each API endpoint is ready
- ✅ Coordinate with M3 on token_counter and analytics
- ✅ Follow the contract formats exactly
- ✅ Don't change API contracts without team discussion

### **Quality Standards:**
- ✅ Test each phase before moving on
- ✅ Handle errors gracefully
- ✅ Return consistent error messages
- ✅ Log important events for debugging

---

## 📞 Communication Points

**When to notify M2 (Frontend):**
- Hour 1: "Keys API live, start Screen 1"
- Hour 3: "Plan API live, start Screen 2"
- Hour 7: "Execute API live, start Screen 3"
- Hour 14: "Analytics ready, add to dashboard"

**When to coordinate with M3 (Integration):**
- Hour 3: "Need token_counter module"
- Hour 7: "Need analytics tracking"
- Hour 14: "Integrate your analytics module"
- Hour 17: "Ready for full system QA"

---

## 🎉 Success Criteria

**By Hour 20, you should have:**
- ✅ All 6 phases complete
- ✅ All endpoints working and tested
- ✅ Security rules enforced
- ✅ Analytics tracking functional
- ✅ Full system tested end-to-end
- ✅ Documentation complete
- ✅ Ready for hackathon demo

**Your backend will be the foundation that makes the entire project work. Build it right, build it secure, build it first!**
