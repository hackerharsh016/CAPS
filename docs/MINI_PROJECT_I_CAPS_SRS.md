# **Table of Contents** 

|**1  Introduction**....................................................................................................................................... 4|
|---|
|**1.1  Purpose**........................................................................................................................................ 4|
|**1.2  Scope**............................................................................................................................................ 4|
|**1.3  Intended Audience**...................................................................................................................... 4|
|**1.4  Definitions, Acronyms and Abbreviations**............................................................................... 5|
|**1.5  References**................................................................................................................................... 5|
|**2  Overall Description**........................................................................................................................... 6|
|**2.1  Product Perspective**.................................................................................................................... 6|
|**2.2  Product Functions (Summary)**.................................................................................................. 6|
|**2.3  User Classes and Characteristics**.............................................................................................. 6|
|**2.4  Operating Environment**............................................................................................................. 6|
|**2.5  Design and Implementation Constraints**.................................................................................. 7|
|**2.6  Assumptions and Dependencies**................................................................................................ 7|
|**3  System Architecture**.......................................................................................................................... 8|
|**3.1  Layered Architecture**................................................................................................................. 8|
|**3.2  High-Level Data Flow**................................................................................................................ 8|
|**3.3  Why a Local Agent Is Required**................................................................................................ 8|
|**3.4  Scalability Model**........................................................................................................................ 8|
|**4  Functional Requirements**................................................................................................................. 9|
|**4.1  Customer Application**................................................................................................................ 9|
|**4.2  Shop Owner Application**............................................................................................................ 9|
|**4.3  Desktop Print Agent**................................................................................................................. 10|
|**4.4  Cloud Backend — Queue, Payments, Privacy**....................................................................... 10|
|**5  External Interface Requirements**.................................................................................................. 12|
|**5.1  User Interfaces**.......................................................................................................................... 12|
|**5.2  Hardware Interfaces**................................................................................................................ 12|
|**5.3  Software Interfaces**................................................................................................................... 12|
|**5.4  Communication Interfaces**...................................................................................................... 12|
|**6  Key Use Cases**.................................................................................................................................. 13|
|**UC-1  Upload Document and Create Print Job**............................................................................ 13|
|**UC-2  Automated Print Execution**................................................................................................. 13|
|**UC-3  Two-Tier Queue Management (Urgent / Flexible)**............................................................ 13|
|**UC-4  Automatic Document Cleanup (Privacy)**........................................................................... 14|
|**UC-5  Shop Owner Sales & Operations Reporting**...................................................................... 14|
|**7  Data Requirements**......................................................................................................................... 15|
|**7.1  users**....................................................................................................................................... 15|
|**7.2  shops**....................................................................................................................................... 15|
|**7.3  printers**.................................................................................................................................. 15|



|2|
|---|



|**7.4  print_jobs**.............................................................................................................................. 16|
|---|
|**7.5  payments**................................................................................................................................ 16|
|**7.6  agent_sessions**........................................................................................................................ 16|
|**8  Non-Functional Requirements**....................................................................................................... 17|
|**8.1  Performance**.............................................................................................................................. 17|
|**8.2  Security**...................................................................................................................................... 17|
|**8.3  Reliability & Fault Tolerance**.................................................................................................. 17|
|**8.4  Scalability**.................................................................................................................................. 17|
|**8.5  Usability**..................................................................................................................................... 17|
|**8.6  Maintainability & Extensibility**.............................................................................................. 17|
|**8.7  Privacy & Compliance**............................................................................................................. 18|
|**9  Other Requirements**....................................................................................................................... 19|
|**9.1  Packaging and Distribution**..................................................................................................... 19|
|**9.2  Monetization Hooks (Non-blocking for MVP)**....................................................................... 19|
|**10  Future Scope**.................................................................................................................................. 20|
|**10.1  CAPS OS — Fully Autonomous Print Kiosk Mode**............................................................ 20|
|**10.2  Other Future Enhancements**................................................................................................. 20|



3 

**1  Introduction** 

## **1.1  Purpose** 

This Software Requirements Specification (SRS) defines the functional, non-functional, interface, and data requirements for CAPS (Cloud Automated Printing Solution with User-Side Configuration) — a cloudbased platform that automates the print-request workflow between customers and local photocopy / Xerox shops. It is intended for use by the development team, project reviewers, and evaluators as the single authoritative reference for what the system must do and how its components must behave. 

## **1.2  Scope** 

CAPS replaces the prevailing manual workflow — where a customer sends a document to a shop owner over WhatsApp and the owner manually downloads, opens, and configures the printer for every job — with an end-to-end digital pipeline. Customers upload documents, configure print settings themselves (paper size, color mode, sides, orientation, copies, page range, binding), pay online, and are placed into a shop-specific First-In-First-Out (FIFO) print queue. A lightweight local Print Agent installed on the shop's computer receives paid, queued jobs and submits them directly to the shop's printer using the Windows printing subsystem, applying the customer-selected settings automatically and without a print dialog. The shop owner's only manual action for a standard job is a single confirmation. 

**In scope for the MVP release:** 

- Customer mobile/web app — shop discovery, document upload, configuration, payment, live queue tracking, notifications. 

- Shop Owner app/dashboard — live queue view, one-click print confirmation, sales and operational reports. 

- Cloud backend — authentication, shop/user management, document storage, print-job and queue orchestration, payments, realtime sync, analytics. 

- Two-tier queue discipline — a customer chooses Urgent (priority-inserted at the front of the queue) or Flexible (standard FIFO) for every print request. 

- Windows Desktop Print Agent — authenticated background service that renders and submits print jobs to the shop's printer(s) using OS-level printing APIs. 

- Privacy-by-design document lifecycle — encrypted transient storage and automatic deletion after printing or a fixed retention window. 

Out of scope for the MVP (noted under Future Scope, Section 10): native macOS/Linux print agents, direct manufacturer-SDK mobile printing, delivery-partner integration, the printing-supplies marketplace, and CAPS OS — a fully unattended, kiosk-mode operating configuration of the Print Agent that removes the shop owner's remaining manual "Print" confirmation. 

## **1.3  Intended Audience** 

- Development team (frontend, backend, and desktop-agent engineers) — as the build specification. 

- System architects and technical reviewers — to validate architectural soundness. 

- Mini project / academic evaluators — to assess completeness and feasibility. 

- QA engineers — to derive test cases and acceptance criteria. 

- Future contributors — as onboarding and reference documentation. 

4 

## **1.4  Definitions, Acronyms and Abbreviations** 

|**Term**|**Definition**|
|---|---|
|CAPS|Cloud Automated PrintingSolution with User-Side Configuration|
|Print Agent|The local Windows background service/executable that receives print jobs and<br>submits them to a shop'sprinter|
|FIFO|First-In-First-Out — thequeue discipline used forprintjob ordering|
|Print Job|A single unit of work: one uploaded document plus its user-selected print<br>configuration|
|Duplex|Double-sidedprinting|
|RLS|Row-Level Security— database access-controlpolicyenforcedper row|
|Realtime Channel|Apush-based subscription that notifies clients of database changes withoutpolling|
|Print Spooler|The Windows OS subsystem thatqueues and dispatchesprintjobs toprinter drivers|
|PSP|Payment Service Provider(e.g., Razorpay)|
|Shop|A registeredphotocopy/ Xerox /print-service outlet on theplatform|



## **1.5  References** 

- 

   - IEEE Std 830-1998 — IEEE Recommended Practice for Software Requirements Specifications. 

- CAPS product concept and architecture discussion transcript (source material for this SRS). 

- Microsoft Win32 Print Spooler API documentation. 

- Supabase platform documentation (Auth, Database, Storage, Realtime). 

- Razorpay Payment Gateway API documentation. 

5 

# **2  Overall Description** 

## **2.1  Product Perspective** 

CAPS is a new, independent, multi-sided SaaS platform (comparable in shape to how food-delivery apps standardized restaurant ordering). It connects three actors — the Customer, the Shop Owner, and the shop's physical Printer hardware — through a cloud backend and a local hardware-bridging agent. It is not a component of an existing system; it introduces a new operational layer on top of the shop's existing Windows PC and printer. 

## **2.2  Product Functions (Summary)** 

- Shop discovery: browse nearby print shops with distance, rating, open/closed status, and live estimated waiting time. 

- Document upload and conversion: accept PDF, DOCX, PPT, JPG, PNG; auto-convert office formats to PDF. 

- User-side print configuration: paper size, color mode, sides, orientation, copies, page range, binding. 

- Live, itemized pricing that updates instantly as settings change. 

- Online payment (UPI / cards / wallet) or optional pay-at-counter. 

- Shop-specific FIFO queue with real-time position and ETA tracking for the customer. 

- Push notifications for job lifecycle events (queued, printing, ready for pickup). 

- Automated, single-click print execution at the shop — no manual printer configuration. 

- Shop Owner dashboard: live queue, sales, and operational reports (daily/weekly/monthly revenue, peak hours, repeat customers). 

- Privacy-first document handling: encrypted transient storage with automatic deletion after printing or a fixed time window. 

## **2.3  User Classes and Characteristics** 

|**User Class**|**Description**|**Technical Proficiency**|
|---|---|---|
|Customer|Individual needing a document printed at a nearby shop;<br>interacts onlywith the mobile/web app|Low to moderate|
|Shop Owner / Staff|Operates the print shop; confirms jobs and monitors sales<br>via dashboard|Low|
|Platform<br>Administrator|Anthropic-style internal role managing shop onboarding,<br>disputes, andplatform health|High|



## **2.4  Operating Environment** 

- Customer & Shop Owner apps: modern web browsers and/or a cross-platform mobile app (Android/iOS), targeting current OS versions at time of release. 

- Desktop Print Agent: Windows 10 and Windows 11 (x64), the dominant OS on shop PCs; packaged as a single installable executable. 

- Cloud backend: managed cloud infrastructure (Supabase-hosted PostgreSQL, Auth, Storage, Realtime, Edge Functions) reachable over HTTPS/WSS. 

- Network: shop PC requires an internet connection for realtime job intake; the Print Agent tolerates short disconnections (see 8.3). 

6 

## **2.5  Design and Implementation Constraints** 

- The Windows Print Spooler cannot silently accept a raw PDF; a PDF must be rendered before submission, so a rendering engine (e.g., PDFium / MuPDF) or a silent-print-capable viewer is a mandatory dependency of the Print Agent. 

- Reliable, driver-independent, dialog-free printing is only achievable through a native OS-level integration; browser-only printing is explicitly excluded as a primary mechanism. 

- The Print Agent must never expose printer access directly to the public internet; all inbound job delivery must be pulled by an authenticated agent, and any local HTTP interface must bind to 127.0.0.1 only. 

- Shop owners must not receive Print Agent source code; distribution is a signed, packaged Windows executable/installer only. 

- Printer capability support (duplex, color, tray selection) varies by manufacturer and driver; the system must degrade gracefully when a requested setting is unsupported by the assigned printer. 

## **2.6  Assumptions and Dependencies** 

- Shop PCs are Windows machines with the target printer already installed and functional at the OS level. 

- Shops have a reasonably stable broadband/Wi-Fi connection for realtime job intake. 

- Third-party services (Supabase, Razorpay, Firebase Cloud Messaging, Maps provider) remain available and within their published rate/service limits. 

- Customers have an internet-connected smartphone or computer capable of running the client app. 

7 

# **3  System Architecture** 

CAPS is deliberately split into three independent layers so that the cloud application, the local hardware bridge, and the physical printing hardware can each evolve without breaking the others. 

## **3.1  Layered Architecture** 

|**Layer**|**Responsibility**|**Key Technologies**|
|---|---|---|
|Cloud Layer|Auth, shop/user data, storage, print-job & queue<br>orchestration, payments, analytics, realtime<br>fan-out|React front ends, Supabase<br>(Postgres, Auth, Storage, Realtime,<br>Edge Functions), Razorpay, FCM,<br>Maps API|
|Local Agent Layer|Per-shop background service: authenticates,<br>receives paid jobs, renders PDFs, applies settings,<br>submits to spooler, reports status|Python (FastAPI- based local<br>service), PDFium/MuPDF<br>renderer, pywin32, PyInstaller<br>packaging|
|Hardware Layer|Physical print execution|Windows Print Spooler,<br>manufacturer printer drivers,<br>physicalprinter|



## **3.2  High-Level Data Flow** 

Customer (uploads document + settings) → Cloud (stores file, creates print_job record, enqueues FIFO position, confirms payment) → Realtime event → Print Agent (authenticated, shop-scoped) pulls the job → Agent downloads the document temporarily, renders it, and maps the stored JSON settings onto native printer parameters → Job is submitted to the Windows Print Spooler → Printer produces the output → Agent deletes the temporary file and reports completion → Cloud updates job status → Customer and Shop Owner both receive real-time status updates and notifications. 

## **3.3  Why a Local Agent Is Required** 

A cloud application cannot drive a USB- or LAN-attached printer directly: there is no browser API for dialog-free, fully-parameterized printing, and manufacturer mobile SDKs are fragmented and inconsistent across brands. A small, authenticated, per-shop local service is therefore the only reliable way to guarantee dialog-free printing with user-defined settings across arbitrary printer hardware. 

## **3.4  Scalability Model** 

Because each shop's Print Agent is responsible only for that shop's printers, the printing workload is inherently distributed — the cloud backend never renders or transmits raw print streams; it only stores metadata, settings, queue state, and status. This keeps cloud load to a standard CRUD + realtime scaling problem even at very high job volumes (e.g., 10,000 shops × 100 jobs/day ≈ 1,000,000 jobs/day are handled as lightweight metadata events, not as centrally-processed print streams). 

8 

# **4  Functional Requirements** 

Requirements are grouped by module and given a unique ID and priority (M = Must have, S = Should have, C = Could have) for MoSCoW-based planning. 

## **4.1  Customer Application** 

|**ID**|**Requirement**|**Priority**|
|---|---|---|
|FR-1.1|The system shall allow a customer to register/login and manage a basicprofile.|M|
|FR-1.2|The system shall display nearby print shops with distance, rating, open/closed status,<br>and live estimated waitingtime.|M|
|FR-1.3|The system shall allow upload of documents in PDF, DOCX, PPT, JPG, and PNG<br>formats.|M|
|FR-1.4|The system shall automatically convert non-PDF office documents to PDF prior to<br>queuing.|S|
|FR-1.5|The system shall let the customer configure paper size (A4/A3/Legal), color mode,<br>sides (single/double), orientation, copy count (1–100), page range (all/custom), and<br>binding (none/spiral/staple/lamination).|M|
|FR-1.6|The system shall compute and display an itemized price (per-page, GST, total) that<br>updates instantlyas settings change.|M|
|FR-1.6a|The system shall let the customer choose a request type for every job: Urgent (priority)<br>or Flexible(standard), beforepayment.|M|
|FR-1.6b|The system shall display the applicable urgent surcharge, the revised total price, and the<br>resulting estimated queue position/ETA before the customer confirms an Urgent<br>request.|M|
|FR-1.7|The system shall support online payment via UPI, card, and wallet, and shall support an<br>optionalpay-at-counter mode where enabled bythe shop.|M|
|FR-1.8|The system shall issue a queue token and display the customer's live queue position and<br>estimated completion time, reflectingits Urgent/Flexible tier.|M|
|FR-1.9|The system shall send push notifications for job-started, printing-complete, and ready-<br>for-pickupevents.|M|
|FR-1.10|The system shall allow the customer to view theirprintjob historyand receipts.|S|



## **4.2  Shop Owner Application** 

|**ID**|**Requirement**|**Priority**|
|---|---|---|
|FR-2.1|The system shall allow a shop owner to register a shop profile, location, service catalog,<br>andper-servicepricing.|M|
|FR-2.2|The system shall display a live FIFO print queue for the shop with job ID, customer,<br>page count, and selected settings.|M|
|FR-2.3|The system shall allow the owner to trigger printing of the next job with a single<br>confirmation action, requiringno manualprinter configuration.|M|
|FR-2.4|The system shall move a job to "Completed" once printing is confirmed and shall notify<br>the customer.|M|
|FR-2.5|The system shall provide a dashboard summarizing today's sales, pending orders,<br>completed orders, revenue, and average waitingtime.|M|



9 

|**ID**|**Requirement**|**Priority**|
|---|---|---|
|FR-2.6|The system shall provide daily, weekly, and monthly revenue reports, best-selling<br>services, averagepagesperjob,peak hours, and repeat-customer statistics.|S|
|FR-2.7|The system shall allow an owner with multiple printers to assign a role to each printer<br>(e.g., B/W, color, large format)and routejobs accordingly.|S|



## **4.3  Desktop Print Agent** 

|**ID**|**Requirement**|**Priority**|
|---|---|---|
|FR-3.1|The agent shall authenticate to the cloud backend using shop-scoped credentials and<br>shall receivejobs for that shoponly.|M|
|FR-3.2|The agent shall subscribe to realtime print-job events and shall not rely on constant<br>polling.|M|
|FR-3.3|The agent shall download the target document to a temporary local location only after<br>payment/authorization is confirmed.|M|
|FR-3.4|The agent shall render the document and submit it to the OS print subsystem with the<br>customer-selected settings appliedprogrammatically, without displayingaprint dialog.|M|
|FR-3.5|The agent shall delete the temporary local copy of the document immediately after the<br>printjob is accepted bythe spooler(or on failure/cancellation).|M|
|FR-3.6|The agent shall report job status transitions (queued, downloading, printing, completed,<br>failed)back to the cloud in real time.|M|
|FR-3.7|The agent shall enumerate installed printers and expose their availability/capabilities to<br>the shopowner for configuration.|S|
|FR-3.8|The agent shall cache an already-authorized job locally and continue/retry printing if<br>the internet connection is brieflylost, then sync status upon reconnection.|S|
|FR-3.9|The agent shall run as a background/tray application that starts automatically with<br>Windows.|S|
|FR-3.10|The agent shall support checking for and applying application updates without<br>requiringmanual reinstallation bythe shopowner.|C|



## **4.4  Cloud Backend — Queue, Payments, Privacy** 

|**ID**|**Requirement**|**Priority**|
|---|---|---|
|FR-4.1|The system shall operate a two-tier queue per shop: a Flexible tier ordered strictly by<br>FIFO, and an Urgent tier that is always served ahead of all Flexiblejobs.|M|
|FR-4.1a|On creation of a paid Urgent job, the system shall insert it after the job currently<br>printing (if any) and after any already-queued Urgent jobs, but ahead of every Flexible<br>job — i.e., FIFO is preserved within each tier, while Urgent jobs as a class jump ahead<br>of Flexiblejobs.|M|
|FR-4.1b|The system shall recompute and push updated queue positions and ETAs to all affected<br>customers in real time whenever an Urgentjob is inserted ahead of them.|M|
|FR-4.1c|The system shall apply a configurable urgent surcharge (flat or percentage, set per<br>shop)to theprice of an Urgentjob.|S|
|FR-4.1d|The system shall allow a shop owner to cap the number of Urgent jobs accepted per<br>hour orperqueue, toprevent tier abuse andpreserve fairness for Flexible customers.|S|
|FR-4.2|The system shall not release a job to the Print Agent until payment is confirmed, unless<br>the shophaspay-at-counter enabled for that transaction.|M|



10 

|**ID**|**Requirement**|**Priority**|
|---|---|---|
|FR-4.3|The system shall store uploaded documents in encrypted storage and shall<br>automatically delete them within a configurable window (e.g., 30 minutes after<br>printing, or a maximum of 24 hours)regardless ofprint outcome.|M|
|FR-4.4|The system shall propagate job status changes to both the customer and shop-owner<br>clients in real time.|M|
|FR-4.5|The system shall record commission/subscription billing events for platform revenue<br>reporting.|S|
|FR-4.6|The system shall enforce that only the authenticated Print Agent belonging to a given<br>shopcan retrieve that shop'squeued documents.|M|



11 

# **5  External Interface Requirements** 

## **5.1  User Interfaces** 

- Customer app: shop discovery list/map, document upload screen, settings configuration form, live price panel, payment screen, queue-tracking screen, notification center. 

- Shop Owner dashboard: live queue panel with a single-tap "Print" action per job, sales/report views, printer configuration screen. 

- Print Agent: minimal system-tray UI (status, start/stop, settings, printer assignment, logs) — no enduser-facing print dialog is ever shown. 

## **5.2  Hardware Interfaces** 

- USB- or LAN-connected printers accessible to the shop's Windows PC through an installed, OSrecognized printer driver. 

- Interaction occurs exclusively through the Windows Print Spooler / Win32 printing API — no direct raw hardware protocol handling is performed by the application. 

## **5.3  Software Interfaces** 

|**Interface**|**Purpose**|
|---|---|
|Supabase (Postgres, Auth, Storage,<br>Realtime, Edge Functions)|Primary backend: identity, relational data, encrypted file storage, realtime<br>job/queue events, serverless logic|
|Razorpay|Onlinepayment collection(UPI / cards / wallets)and settlement|
|Firebase Cloud Messaging|Push notifications to customer and shop-owner clients|
|Google Maps / OpenStreetMap|Shopdiscovery, distance calculation,geolocation display|
|PDFium / MuPDF (or equivalent<br>renderer)|Server/agent-side rendering of PDF pages prior to spooler submission|
|Win32 Print Spooler API (pywin32)|Printer discovery, capability query, job submission, and queue/status<br>monitoringon Windows|



## **5.4  Communication Interfaces** 

- Customer/Shop Owner clients ↔ Cloud: HTTPS REST calls plus a realtime (WebSocket-based) subscription channel for live queue and status updates. 

- Cloud ↔ Print Agent: outbound-initiated authenticated realtime subscription (the agent pulls jobs; it is never addressed directly from the internet). 

- Print Agent local interface (where exposed): an HTTP API bound strictly to 127.0.0.1, used only for local diagnostics/testing (e.g., POST /print, GET /status, GET /printers, GET /queue) and never exposed on the shop's network. 

12 

# **6  Key Use Cases** 

## **UC-1  Upload Document and Create Print Job** 

**Primary Actor: Customer** 

Preconditions: Customer is registered and has selected a shop. 

**Main Flow:** 

- 1. Customer uploads a document (PDF/DOCX/PPT/JPG/PNG). 

- 2. System converts non-PDF formats to PDF automatically. 

- 3. Customer selects paper size, color, sides, orientation, copies, page range, and binding. 

- 4. System computes and displays live pricing. 

- 5. Customer completes payment (online or pay-at-counter, if enabled). 

- 6. System creates a print_job record, assigns the next FIFO position for that shop, and stores the document in encrypted storage. 

- 7. Customer receives a queue token and live position/ETA. 

_Postcondition: A paid, correctly-ordered print job exists in the shop's queue and is visible to the Print Agent._ 

## **UC-2  Automated Print Execution** 

**Primary Actor: Print Agent (on behalf of Shop Owner)** 

Preconditions: A paid job is at or near the front of the FIFO queue; the agent is authenticated and online. 

**Main Flow:** 

- 1. Agent receives a realtime event for the new/next job. 

- 2. Agent downloads the document to a temporary encrypted local location. 

- 3. Agent renders the document and maps the stored JSON settings to native printer parameters. 

- 4. Agent submits the job to the Windows Print Spooler for the assigned printer — no dialog is shown. 

- 5. Shop Owner presses a single "Print" confirmation in the dashboard (or the job proceeds automatically if auto-print is enabled). 

- 6. Agent monitors the spooler and reports status transitions (printing → completed / failed) to the cloud in real time. 

- 7. Agent deletes the temporary local file immediately after submission is accepted. 

_Postcondition: The document is printed exactly as configured by the customer; job status is "Completed" and visible to both parties; no residual file remains on the shop PC._ 

## **UC-3  Two-Tier Queue Management (Urgent / Flexible)** 

**Primary Actor: System (Cloud)** 

Preconditions: One or more paid jobs exist for a shop; each job is tagged Urgent or Flexible. 

**Main Flow:** 

- 1. System maintains two ordered sub-lists per shop: Urgent (priority) and Flexible (standard). 

- 2. System orders jobs strictly by payment/creation timestamp within each sub-list (FIFO-within-tier). 

- 3. System always serves the head of the Urgent sub-list next, and only pulls from the Flexible sub-list when the Urgent sub-list is empty. 

- 4. When a new Urgent job is paid for, the system inserts it at the end of the Urgent sub-list — i.e., ahead of every Flexible job, but behind the job currently printing and behind any earlier Urgent jobs. 

13 

- 5. System pushes updated queue positions and revised ETAs, via realtime channels, to every customer whose effective position changed as a result. 

- 6. System exposes each customer's live position, tier, and the currently-printing job to all clients via realtime updates. 

- 7. On completion or cancellation of the head job, the system advances the queue (Urgent first, then Flexible) and recalculates downstream ETAs. 

_Postcondition: Flexible jobs are never reordered relative to each other; Urgent jobs are always served before pending Flexible jobs while remaining FIFO-ordered among themselves; every customer has an accurate, continuously updated position and tier._ 

## **UC-4  Automatic Document Cleanup (Privacy)** 

**Primary Actor: System (Cloud + Print Agent)** 

Preconditions: A document has been uploaded and stored in encrypted storage. 

**Main Flow:** 

- 1. System stores the document only in encrypted storage, never in shop-owner-accessible plain storage. 

- 2. Print Agent deletes its temporary local copy immediately after the print job is accepted by the spooler. 

- 3. Cloud storage deletes the source document automatically after printing completes, or in any case within the configured retention window (e.g., 24 hours). 

_Postcondition: No customer document persists on the shop's computer or in cloud storage beyond the retention policy._ 

## **UC-5  Shop Owner Sales & Operations Reporting** 

**Primary Actor: Shop Owner** 

Preconditions: The shop has completed one or more jobs. 

**Main Flow:** 

- 1. Owner opens the dashboard Reports section. 

- 2. System aggregates completed job data into daily/weekly/monthly revenue, best-selling services, average pages per job, peak hours, and repeat-customer metrics. 

- 3. Owner reviews figures to inform pricing, staffing, and inventory decisions. 

_Postcondition: Owner has an accurate, up-to-date operational view of the shop without manual bookkeeping._ 

14 

# **7  Data Requirements** 

The following logical schema illustrates the minimum entities and fields required; it is not a physical DDL and may be normalized further during implementation. 

### **7.1  users** 

|**Field**|**Type**|**Notes**|
|---|---|---|
|id|UUID(PK)|Primarykey, Supabase Auth user id|
|role|enum|customer|shop_owner|admin|
|name|text|Displayname|
|phone|text|Used for notifications|
|created_at|timestamp|Registration time|



### **7.2  shops** 

|**Field**|**Type**|**Notes**|
|---|---|---|
|id|UUID(PK)|Primarykey|
|owner_id|UUID (FK →<br>users.id)|Shop owner|
|name, address, geo_lat,<br>geo_lng|text / numeric|Discovery and mapping|
|pricing_config|JSONB|Per-page /per-setting price table|
|urgent_surcharge_config|JSONB|Flat/percentage urgent surcharge and optional hourly Urgent-<br>job cap|
|auto_print_enabled|boolean|Whetherjobsprint without manual confirmation|
|status|enum|open|closed|



### **7.3  printers** 

|**Field**|**Type**|**Notes**|
|---|---|---|
|id|UUID(PK)|Primarykey|
|shop_id|UUID (FK →<br>shops.id)|Owning shop|
|name|text|OS-reportedprinter name, e.g. "Canon LBP2900"|
|role|enum|bw|color|large_format|
|is_default|boolean|Default routingtarget|



15 

### **7.4  print_jobs** 

|**Field**|**Type**|**Notes**|
|---|---|---|
|id|bigint / UUID(PK)|Primarykey, also thequeue token|
|shop_id|UUID (FK →<br>shops.id)|Target shop|
|customer_id|UUID (FK →<br>users.id)|Requesting customer|
|document_url|text|Pointer to encrypted storage object|
|settings|JSONB|{ copies, paper, color, duplex, orientation, pages, binding,<br>printer}|
|priority_tier|enum|urgent|flexible — selected bythe customer beforepayment|
|price_total,<br>price_breakdown|numeric / JSONB|Computed at submission time; breakdown includes urgent<br>surcharge when applicable|
|queue_position|integer|Effective position — recomputed within tier order (Urgent tier<br>alwaysprecedes Flexible tier)|
|status|enum|pending_payment | queued | printing | completed | failed |<br>cancelled|
|created_at, updated_at,<br>deleted_at|timestamp|Lifecycle + auto-delete tracking|



### **7.5  payments** 

|**Field**|**Type**|**Notes**|
|---|---|---|
|id|UUID(PK)|Primarykey|
|print_job_id|UUID (FK →<br>print_jobs.id)|Associated job|
|amount, currency|numeric / text|Transaction amount|
|method|enum|upi|card|wallet| pay_at_counter|
|gateway_ref|text|Razorpay payment/order id|
|status|enum|initiated|success|failed|refunded|



### **7.6  agent_sessions** 

|**Field**|**Type**|**Notes**|
|---|---|---|
|id|UUID(PK)|Primarykey|
|shop_id|UUID (FK →<br>shops.id)|Owning shop|
|agent_version|text|Installed Print Agent version, for auto-update|
|last_seen_at|timestamp|Heartbeat for online/offline status|
|auth_token_ref|text|Reference to securelystored session credential|



16 

# **8  Non-Functional Requirements** 

## **8.1  Performance** 

- Live price recalculation shall reflect a settings change within 300 ms on a typical mobile connection. 

- Queue position and status updates shall propagate to clients within 2 seconds of the underlying state change via realtime channels (not polling). 

- The Print Agent shall begin processing an authorized job within 5 seconds of receiving the realtime event, network conditions permitting. 

## **8.2  Security** 

- All client-cloud and agent-cloud traffic shall be encrypted in transit (HTTPS/WSS). 

- Uploaded documents shall be stored encrypted at rest; access shall be restricted to the owning customer, the destination shop's authenticated agent, and platform administrators. 

- The Print Agent shall authenticate with shop-scoped credentials and shall only be able to retrieve jobs belonging to its own shop (enforced via backend row-level security policies). 

- Any local HTTP interface exposed by the Print Agent shall bind only to 127.0.0.1 and shall never be reachable from the shop's LAN or the public internet. 

- A job shall not be released to the Print Agent until payment success is confirmed by the payment gateway, except where pay-at-counter is explicitly enabled. 

- Copying the Print Agent executable to another machine shall not, by itself, grant access to any shop's jobs, since a valid shop account and access token are required. 

## **8.3  Reliability & Fault Tolerance** 

- If a shop's internet connection drops after a job has been downloaded and authorized, the Print Agent shall continue/complete the local print operation and sync status upon reconnection. 

- The system shall detect and surface printer-level error states (out of paper, paper jam, low toner, printer offline) to the shop-owner dashboard where the driver exposes them. 

- The system shall retry failed status updates from the agent to the cloud with backoff, without duplicating completed jobs. 

## **8.4  Scalability** 

- The cloud backend shall handle metadata, queue, and status events only; document rendering and physical printing load remains local to each shop, keeping backend load largely independent of total print volume. 

- The architecture shall support horizontal growth to a large number of shops without redesigning the printing layer, since each Print Agent independently serves only its own shop. 

## **8.5  Usability** 

- A first-time customer shall be able to complete upload → configure → pay in under 2 minutes without prior training. 

- Shop owner installation of the Print Agent shall require no more steps than a standard Windows application installer (download → next → next → install → done), with no Python or technical dependency installation exposed to the owner. 

- The shop owner's per-job action shall be reducible to a single confirmation tap under normal operation. 

## **8.6  Maintainability & Extensibility** 

17 

- The printing engine within the Print Agent shall be exposed as a single, clearly-defined internal function/interface so the rest of the agent (auth, queue listening, UI) can be modified independently of the print-submission logic. 

- The cloud platform and the Print Agent shall be maintained as independently deployable/versioned components communicating only through authenticated APIs and realtime events. 

- The Print Agent shall support remote version checks and self-update without requiring shop owners to manually reinstall. 

## **8.7  Privacy & Compliance** 

- Customer documents shall never be persisted on the shop's computer beyond the temporary window needed to submit the print job. 

- Cloud-stored documents shall be automatically purged within the configured retention window regardless of whether printing succeeded. 

- The system shall maintain an audit trail of job status transitions without retaining the underlying document content once deleted. 

18 

# **9  Other Requirements** 

## **9.1  Packaging and Distribution** 

- The Print Agent shall be distributed only as a signed, packaged Windows executable/installer; raw source files shall never reach the shop owner. 

- The installer shall optionally register the agent to start automatically with Windows and to run minimized in the system tray. 

## **9.2  Monetization Hooks (Non-blocking for MVP)** 

- Per-order commission charged to the shop owner. 

- Free tier (capped daily orders) vs. Premium subscription (unlimited orders, analytics, priority listing). 

- Sponsored/featured shop placement. 

19 

# **10  Future Scope** 

## **10.1  CAPS OS — Fully Autonomous Print Kiosk Mode** 

In the MVP, every job still requires exactly one manual action from the shop owner: reviewing the incoming request and pressing "Print." CAPS OS is a proposed operating mode of the Print Agent that removes this last manual step, turning any ordinary Windows PC and printer — with no hardware modification and no printer firmware changes — into a self-service, unattended printing kiosk. 

### **Concept:** 

- The Print Agent runs in an unattended "kiosk" configuration on the shop PC (optionally paired with a simple touchscreen/tablet front-end for walk-in customers). 

- A customer uploads a document and configures settings either remotely (via the CAPS app) or directly at the kiosk screen. 

- Payment is completed online or via an in-store payment terminal linked to the kiosk. 

- On payment confirmation, the system automatically accepts the request — the human "Print" confirmation step (FR-2.3) is replaced by an autonomous acceptance rule — and the Print Agent proceeds exactly as in the standard automated pipeline (render → apply settings → submit to spooler). 

- The printed output is dispensed for pickup with no shop staff involvement for the transaction. 

### **Key characteristics:** 

- No hardware or firmware modification — CAPS OS is a software configuration layer on top of the same Print Agent and the same OS-level Print Spooler integration already defined in this SRS (Section 3), not a new print pathway. 

- Opt-in per shop and, where useful, per printer — an owner may run some printers in manual (FR-2.3) mode and others in CAPS OS unattended mode. 

- Reuses the existing Urgent/Flexible queue (Section 6, UC-3), payment gating (FR-4.2), and autodelete privacy pipeline (FR-4.3, UC-4) without modification. 

- Requires additional safeguards before general release: automatic pause on printer-error states (out of paper, jam, low toner — already detectable per Section 8.3), a remote/physical stop control for the owner, fraud and abuse checks on unattended payment acceptance, and a maximum unattended job size/cost threshold. 

### **Impact:** 

CAPS OS converts the platform from "queue automation with one manual step" into a genuine unattended printing kiosk product — enabling 24×7 self-service printing points (e.g., hostel common rooms, library corridors, co-working spaces, apartment complexes) that require no on-site staff at all, using printers the operator already owns. 

## **10.2  Other Future Enhancements** 

- Cross-platform Print Agent support (macOS/Linux) for shops outside the Windows ecosystem. 

- Direct manufacturer-SDK mobile printing for supported Wi-Fi printers, as a supplementary fast-path alongside the universal agent. 

- Delivery-partner integration for print-and-deliver-to-home flows. 

- Printing-supplies marketplace (paper, ink, toner, spare parts) for shop owners. 

- Expansion into college/university campuses, corporate print centers, government service centers, libraries, co-working spaces, and franchise print networks. 

- Deeper analytics and demand forecasting for shop owners based on aggregated, anonymized platform data. 

- Dynamic, demand-based urgent-surcharge pricing (e.g., higher urgent fee during peak queue load). 

20 

# **Appendix A: Traceability Note** 

This SRS was derived from the CAPS product concept note and the accompanying architecture discussion covering desktop print-agent feasibility, printing-engine technology choices (Windows Print Spooler API, PDFium/MuPDF, PyInstaller packaging), and the three-layer SaaS architecture (Cloud / Local Agent / Hardware). Any requirement not explicitly present in the source material was reasonably inferred from stated goals (e.g., specific NFR thresholds) and should be validated with stakeholders before implementation sign-off. 

21 

