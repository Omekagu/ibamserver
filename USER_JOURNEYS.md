# iBam Health — All User Journeys

> Platform URL: **https://www.ibamhealth.com**  
> API: **http://10.0.1.44:5000**  
> Mobile APK: sideload or Play Store once published  
> Six roles: **Patient · Doctor · Pharmacy Partner · Lab · Field Agent · Admin**
> Lab

---

## Table of Contents

1. [Patient Journey](#1-patient-journey)
2. [Doctor Journey](#2-doctor-journey)
3. [Pharmacy Partner Journey](#3-pharmacy-partner-journey)
4. [Lab Journey](#4-lab-partner-journey)
5. [Field Agent Journey](#5-field-agent-journey)
6. [Admin Journey](#6-admin-journey)
7. [Cross-Role Flows](#7-cross-role-flows)

---

## 1. Patient Journey

### 1.1 Registration & Onboarding

1. Visit **https://www.ibamhealth.com** (web) or open the mobile app.
2. Tap **Get Started** → **Sign Up**.
3. Fill in name, email address, phone number, and password. Select role **Patient**.
4. Submit → receive a 6-digit OTP via email (and SMS if Termii is configured).
5. Enter OTP on the verification screen.
   - If OTP expires, tap **Resend OTP**.
6. Account is activated. On first login, optionally complete the **Health Profile** (blood type, allergies, chronic conditions).
7. Alternatively, tap **Continue with Google** for one-click OAuth sign-in. If the Google account is new, a role-selection step appears before account creation.

---

### 1.2 Login

| Step | Web                                | Mobile                              |
| ---- | ---------------------------------- | ----------------------------------- |
| 1    | Go to `/login`                     | Open app → arrives at auth screen   |
| 2    | Enter email / phone + password     | Enter email / phone + password      |
| 3    | Press **Log In**                   | Press **Log In**                    |
| 4    | Redirected to `/patient` dashboard | Redirected to `/(tabs)` home screen |

- After **5 failed attempts** the account is locked for **15 minutes** (error message shows remaining time).
- After **2 minutes of inactivity** on mobile, the app auto-signs out (session guard).
- Use **Forgot Password** → enter email → click reset link in email → set new password.

---

### 1.3 Home Dashboard (Mobile)

After login the patient lands on the **Home** tab:

- **Stats bar** — total consultations, lab tests ordered, prescriptions received.
- **Upcoming appointment card** — shows next appointment with a **Join** button if within window.
- **Service grid** — quick-launch buttons:
  - Find Doctor
  - Pharmacy
  - Symptom Check (Triage)
  - My Appointments
  - Subscribe
  - Nearby Facilities
- **Lab Tests promo banner** — tap to browse labs.
- **Health Tips carousel** — admin-broadcast tips.
- **Recent activity** — last few notifications/actions.

---

### 1.4 Symptom Check (Triage)

1. Tap **Symptom Check** from the home service grid.
2. The triage questionnaire loads — multi-step questions about symptoms, severity, and duration.
3. Each answer updates a running score.
4. On completion, a **classification** is returned:
   - **Green** — self-care recommended; suggestion to book a consultation.
   - **Yellow** — moderate concern; recommendation to see a doctor within 24–48 h.
   - **Red** — emergency; emergency contacts (199 / 112) shown, nearest facility listed, push notification + email alert sent immediately.
5. From the result screen, tap **Book Appointment** to continue to the booking flow.

---

### 1.5 Booking an Appointment

1. Tap **Find Doctor** (home grid or **Book** tab on web).
2. Browse the doctor list — filter by **specialization**, see rating, bio, and consultation fee.
3. Tap a doctor → view full profile, reviews, available slots.
4. Select **consultation type**: Video · Audio · Chat.
5. Pick a date and available time slot.
6. Optionally flag as **Urgent**.
7. Tap **Book & Pay** → Paystack payment screen (card / bank transfer).
8. On payment success, appointment is **confirmed**; doctor and patient both receive:
   - In-app notification
   - Email confirmation
   - SMS (if Termii configured)
9. **24-hour reminder** and **1-hour reminder** emails + in-app notifications are sent automatically by the cron scheduler.

---

### 1.6 Joining a Consultation

1. From **Appointments** tab, find the confirmed appointment.
2. At the scheduled time, the **Join** button becomes active.
3. Tap **Join**:
   - **Chat** → opens the real-time chat room (Socket.io, with typing indicator).
   - **Audio/Video** → Agora RTC channel opens; patient joins the call.
4. During the consultation:
   - Send text messages and share files (images, PDFs).
   - If video, camera and microphone controls appear.
   - Typing indicator shows when the other party is typing.
5. Doctor ends the session; patient receives a **consultation summary** notification.
6. Patient can leave a **review and rating** for the doctor after the session.

---

### 1.7 Receiving & Managing Prescriptions

1. After a consultation the doctor may issue an **e-prescription**.
2. Patient receives a push notification + email: _"Your prescription is ready."_
3. Go to **Records** tab → **Prescriptions** → view full prescription details (medication name, dosage, frequency, duration).
4. Tap **Forward to Pharmacy** to send directly to a partner pharmacy.
5. Select the pharmacy from the list → order is created automatically.

---

### 1.8 Ordering from the Pharmacy

1. Open **Pharmacy** from home grid or via forwarded prescription.
2. Browse partner pharmacies; select one.
3. Browse the drug catalog (search by name).
4. Add items to cart (or confirm the forwarded prescription items).
5. Select **Delivery** or **Pickup**.
6. Proceed to payment → Paystack.
7. Order confirmed. Track status:  
   `Pending → Processing → Ready → Dispatched → Delivered`
8. Status change notifications arrive via push + email.

---

### 1.9 Requesting Lab Tests

1. Tap **Labs** from home grid or Records tab.
2. Browse partner labs, view test catalogs and pricing.
3. Select tests → choose collection type:
   - **Walk-in** — visit the lab yourself.
   - **Home Visit** — a field agent collects the sample at your address.
4. Confirm address (for home visit) and preferred date.
5. Pay .
6. Request confirmed. For home visit, a field agent is assigned (you receive notification).
7. Track status: `Pending → Collected → Processing → Result Uploaded`.
8. When results are ready: push notification + email → view/download from **Records → Lab Results**.

---

### 1.10 Subscriptions

1. Tap **Subscribe** from home grid.
2. Browse **Platform Subscription Plans** (e.g., Basic, Standard, Premium).
3. Select a plan → Paystack recurring subscription flow.
4. Active plan unlocks features (discounted consultations, priority booking, etc.).
5. Manage / cancel subscription from **Subscriptions** screen or web `/patient/subscriptions`.

**Product Subscriptions (Recurring Drug/Test Deliveries):**

- While placing a pharmacy order or lab test, toggle **Recurring** → set frequency (weekly / monthly).
- Manage from **Records → Subscriptions**.

---

### 1.11 Profile & Health Information

| Section             | What you can update                                          |
| ------------------- | ------------------------------------------------------------ |
| **Edit Profile**    | Name, phone number, profile photo                            |
| **Health Profile**  | Blood type, genotype, allergies, existing conditions         |
| **Medical History** | Add past diagnoses, surgeries, medications                   |
| **KYC**             | Upload NIN, complete face match (required for some services) |
| **Notifications**   | View all; tap to mark read or mark all read                  |

---

### 1.12 Finding Nearby Facilities

1. Tap **Facilities** from home grid.
2. Allow location permission (or enter address manually).
3. Map and list view shows: hospitals, clinics, pharmacies, labs, emergency rooms.
4. Filter by **type**.
5. Tap a facility for address, phone, hours, and directions link.

---

### 1.13 Payment History

Go to **Payments** screen (web: `/patient/payments`):  
View all transactions with date, amount, status, and reference number.

---

## 2. Doctor Journey

### 2.1 Registration & Onboarding

**Web (recommended for initial setup):**

1. Go to **https://www.ibamhealth.com/signup**.
2. Fill in name, email, phone, password. Select role **Doctor**.
3. Verify email via OTP.
4. Log in → redirected to the **Doctor Portal** (`/doctor`).
5. Complete **Doctor Profile**: specialization, bio, years of experience, license number, consultation fee.
6. Upload **medical license** (PDF/image → Cloudinary).
7. Submit for **Admin KYC review** — account shows _"Pending Verification"_ banner until approved.
8. Complete **KYC** (NIN, face match) at `/doctor/kyc` to unlock payout eligibility.

**Mobile:**  
Same flow — after sign-up with doctor role, the app routes to `/(doctor)` layout.

---

### 2.2 Login

- Web: `/login` → redirected to `/doctor`.
- Mobile: login screen → redirected to `/(doctor)` tab navigator.

---

### 2.3 Doctor Dashboard

- **Availability toggle** — flip to **Available** to accept new bookings; **Offline** hides you from patient search.
- **Today's Appointments** count and upcoming list (next 4).
- **Stats**: today's appointments, total upcoming, average rating.
- **KYC banner** (if not yet verified) — tap to complete.
- **Quick actions**: My Schedule · Patients · Earnings · Profile.

---

### 2.4 Setting Availability

1. Go to **Availability** tab (web: `/doctor/availability`; mobile: `/(doctor)/availability`).
2. Add slots: select day(s), start time, end time.
3. Toggle **Recurring** (repeats weekly) vs one-off.
4. Save — slots become visible to patients in the booking flow.
5. Delete or edit existing slots as needed.

---

### 2.5 Managing Appointments

1. Open **Schedule** tab (web: `/doctor/appointments`).
2. View upcoming and past appointments; filter by status (Pending / Confirmed / Completed / Cancelled).
3. For each appointment:
   - See patient name, consultation type (video/audio/chat), date/time.
   - **Join** button activates at the scheduled time.
   - **Schedule Follow-up** — book a follow-up appointment for the patient from within the record.

---

### 2.6 Conducting a Consultation

1. Tap **Join** on the appointment card.
2. The consultation room opens:
   - **Chat** → real-time messages with typing indicator.
   - **Audio/Video** → Agora channel with mic/camera controls.
3. During the session:
   - Type messages; share images or file attachments.
   - Access patient profile (medical history, previous prescriptions, lab results).
4. At the end of session:
   - Tap **End Consultation**.
   - Write **SOAP / consultation notes** (saved to patient record).
   - Issue an **e-prescription** (see §2.7).

---

### 2.7 Issuing a Prescription

1. During or after consultation, open **Prescriptions**.
2. Tap **New Prescription**.
3. Add medications:
   - Drug name, dosage, frequency, duration, instructions.
   - Repeat for each medication.
4. Tap **Send to Patient** → patient receives push + email notification.
5. Patient can then forward it to a pharmacy.

---

### 2.8 Requesting a Lab Test for a Patient

1. In the consultation room or from the patient record, tap **Request Lab Test**.
2. Select the test(s) from the lab catalog.
3. Choose collection type: walk-in or home visit.
4. Submit → patient receives notification to complete payment.
5. Lab receives the request once payment is confirmed.

---

### 2.9 Earnings & Payouts

1. Go to **Earnings** tab (web: `/doctor/earnings`).
2. View breakdown per consultation: gross amount, platform cut (%), net amount, payout status.
3. Running totals: **Total Earned** / **Pending Payout**.
4. Tap **Request Payout** → enters admin review queue.
5. Admin approves → funds transferred (Paystack direct transfer or manual bank transfer).
6. Payout history shows all past withdrawals.

---

### 2.10 KYC Verification

1. Go to **KYC** (`/doctor/kyc` on web; `/(doctor)` dashboard banner on mobile).
2. Three steps:
   - **NIN Verification** — enter NIN → verified against Dojah API.
   - **Face Match** — selfie captured → compared against NIN photo.
   - **CAC Verification** (optional for registered practitioners) — enter CAC number.
3. All three submitted → Admin reviews and approves.
4. On approval: payout unlocked, verification badge shown on public profile.

---

### 2.11 My Patients

1. Go to **Patients** tab (`/doctor/patients` web; `/(doctor)/patients` mobile).
2. View list of all patients who have had consultations with you.
3. Tap a patient to view:
   - Profile and contact info
   - Previous consultations
   - Prescriptions issued
   - Lab results (if shared)

---

## 3. Pharmacy Partner Journey

### 3.1 Onboarding (Web)

1. A **Pharmacy Partner** account is created by the Admin, **or** the partner self-registers:
   - Go to **https://www.ibamhealth.com/signup** → role: **Pharmacy Partner**.
   - Fill in name, email, phone, password.
   - Verify email via OTP.
2. Log in → redirected to **Partner Portal** at `/partner/pharmacy`.
3. Complete business profile: pharmacy name, address, contact number, coverage area.
4. Submit for **Admin approval** (status: _Pending_).
5. Admin approves → account fully activated; partner receives approval email with portal link.

---

### 3.2 Login

- Web: `/login` → `/partner/pharmacy`.
- Mobile: login → `/(partner)` tabs (shows Pharmacy badge in header).

---

### 3.3 Managing Orders

1. Open **Orders** (default view on dashboard).
2. Incoming orders appear in real-time (Socket.io) with:
   - Patient name
   - Items ordered (drug name, quantity)
   - Order total
   - Delivery or pickup flag
3. Tap an order to view full details.
4. Update status through the fulfillment pipeline:

```
Pending → Processing → Ready → Dispatched → Delivered
```

5. Patient receives a push notification + email on each status change.
6. Mark order **Delivered** to complete fulfillment.

---

### 3.4 Managing Drug Catalog

1. Go to **Catalog** tab (`/partner/pharmacy/catalog` on web).
2. View all listed drugs with name, price, stock status.
3. **Add Drug** — name, category, unit price, stock availability.
4. **Edit** existing entry — update price or toggle in/out of stock.
5. **Remove** delisted items.
6. Changes reflect immediately in the patient-facing drug browser.

---

### 3.5 Earnings & Payouts

1. Go to **Profile & Payouts** (`/partner/pharmacy/profile`).
2. View total fulfilled orders, gross revenue, platform cut, net earnings.
3. Request payout → enters admin queue.
4. Admin approves → funds transferred.

---

## 4. Lab Journey

### 4.1 Onboarding (Web)

1. Register at **https://www.ibamhealth.com/signup** → role \*_Lab _, or created by Admin.
2. Verify email via OTP.
3. Complete lab profile: lab name, address, contact, coverage area, accreditation details.
4. Submit for Admin approval.
5. On approval: partner receives email with portal link `/partner/lab`.

---

### 4.2 Login

- Web: `/login` → `/partner/lab`.
- Mobile: login → `/(partner)` tabs (Lab badge).

---

### 4.3 Managing Lab Requests

1. Open **Requests** tab (default dashboard view).
2. Each incoming request shows:
   - Patient name
   - Tests requested
   - Collection type: **Walk-in** or **Home Visit**
   - Request date/time
3. Tap a request to see full details.
4. Update status:

```
Pending → Collected → Processing → Completed
```

5. For **Home Visit** requests, assign a **Field Agent** from the field agent list (see §5).
6. When the agent marks the sample collected, status auto-advances.

---

### 4.4 Uploading Test Results

1. Once processing is complete, open the request.
2. Tap **Upload Result** → select file (PDF, image).
3. File uploads to Cloudinary and is linked to the request.
4. Patient receives push notification + email: _"Your lab results are ready."_
5. Patient can download/view the result from **Records → Lab Results**.

---

### 4.5 Managing Test Catalog

1. Go to **Test Catalog** (`/partner/lab/tests`).
2. View all offered tests with name, price, turnaround time.
3. **Add Test** — name, category, price, sample type, turnaround.
4. **Edit / Remove** existing entries.
5. Changes reflect immediately in the patient-facing lab browser.

---

### 4.6 Earnings & Payouts

1. Go to **Profile & Payouts** (`/partner/lab/profile`).
2. View fulfilled test counts, gross revenue, platform cut, net earnings.
3. Request payout → admin review queue → approval → transfer.

---

## 5. Field Agent Journey

### 5.1 Onboarding

Field agents are created by the **Lab** or the **Admin**:

1. Admin or lab creates a field agent account under their lab.
2. Agent receives an email with login credentials.
3. Agent downloads the **mobile app**, logs in.
4. App detects `role: field_agent` → routes to `/(field_agent)` tab navigator.

---

### 5.2 Login (Mobile Only)

1. Open app → login screen.
2. Enter email + password (credentials provided by lab/admin).
3. App routes to **Field Agent** schedule screen.

---

### 5.3 Viewing the Schedule

1. **Schedule** tab loads automatically on login.
2. All assigned home-visit requests appear as cards showing:
   - Patient name and phone number
   - Scheduled date and time
   - Patient address
   - Tests to be collected
   - Status badge: `Scheduled | En Route | Arrived | Collected`
3. Pull down to **refresh** the list.

---

### 5.4 Conducting a Home Visit

1. Note the patient address from the visit card.
2. Travel to the patient's location.
3. Collect the sample(s) listed.
4. Return to the app → find the visit card.
5. Tap **Mark Sample Collected**.
6. A confirmation dialog appears: _"Mark sample as collected for [Patient Name]?"_
7. Tap **Confirm**.
8. Status updates to **Collected** on the server.
9. The lab sees the update on their dashboard.
10. Patient receives a notification: _"Your sample has been collected and is being processed."_

---

### 5.5 Profile

- View name, email, and phone.
- Tap **Sign Out** to log out.

---

## 6. Admin Journey

### 6.1 Access

1. Navigate to **https://www.ibamhealth.com/admin** (web only — no mobile admin panel).
2. Log in with admin credentials (`ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`).
3. Role is `admin` → redirected to `/admin` dashboard.

---

### 6.2 Dashboard

- **KPIs**: total users, active doctors, consultations today, revenue this month, active subscriptions.
- **Pending KYC queue** — doctors awaiting verification.
- **Recent activity** — latest registrations, payments, alerts.

---

### 6.3 Doctor Management (`/admin/doctors`)

| Action                 | How                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------- |
| View all doctors       | Paginated table with name, specialization, status                                   |
| Approve KYC            | Click doctor → review uploaded license + NIN/face match → **Approve** or **Reject** |
| Suspend doctor         | Toggle active/suspended                                                             |
| Create doctor manually | **+ Add Doctor** button                                                             |
| View full profile      | Click name → see bio, license, consultation history                                 |

On approval:

- Doctor receives an email: _"Your account has been verified."_
- KYC badge appears on their public profile.
- Payout feature unlocked.

---

### 6.4 Partner Management

**Pharmacies (`/admin/pharmacy`):**

- View all pharmacy partners.
- Approve / reject pending onboarding applications.
- Suspend or reactivate accounts.
- Approved pharmacy receives email with portal link.

**Labs (`/admin/labs`):**

- Same flow as pharmacies.
- Manage field agent assignments.

---

### 6.5 User Management (`/admin/users`)

- Browse all patient accounts.
- View profile, appointment history, payment history.
- Suspend / unsuspend user accounts.

---

### 6.6 Appointments (`/admin/appointments`)

- View all appointments across the platform.
- Filter by date, status, doctor, or patient.
- Useful for dispute resolution or support.

---

### 6.7 Payments & Revenue (`/admin/payments`)

- Full transaction log: amount, reference, type, status, date.
- Filter by date range, payment method, or user.
- Export for accounting.

---

### 6.8 Payouts (`/admin/payouts`)

1. Doctors and partners submit payout requests.
2. Admin opens `/admin/payouts` — pending requests listed with amount and bank details.
3. Review → **Approve** or **Reject** with optional note.
4. On approval: trigger Paystack transfer or mark as manually disbursed.
5. Requester receives notification.

---

### 6.9 Triage Questions (`/admin/triage` or via settings)

- View current symptom question bank.
- Edit question text, answer options, and scoring weights.
- Add new questions or disable existing ones.
- Changes take effect on the next triage session.

---

### 6.10 Broadcast (`/admin/broadcast`)

1. Compose a **Health Tip** or **Announcement**.
2. Select target audience (all users, patients only, doctors only, etc.).
3. Press **Broadcast** → in-app notification sent to all matching users.
4. Message appears in patients' **Health Tips** carousel on the home screen.

---

### 6.11 Subscription Plans (`/admin/plans`)

- View all active subscription tiers.
- **Create Plan** — name, price, billing interval (monthly/yearly), features list.
- **Edit** existing plan pricing or features.
- **Disable** a plan (existing subscribers unaffected until renewal).

---

### 6.12 Audit Log (`/admin/audit`)

- Chronological log of all admin actions (who did what, when, on which resource).
- Useful for compliance and incident investigation.

---

### 6.13 Platform Settings (`/admin/settings`)

- `PLATFORM_CUT_PERCENT` — change the commission percentage.
- Payment method toggle (enable/disable bank transfer).
- Other global configuration flags.

---

## 7. Cross-Role Flows

### 7.1 Complete Patient → Doctor Consultation Flow

```
Patient books appointment (pays)
        ↓
Doctor receives notification + appointment in schedule
        ↓
Cron sends 24h reminder to both parties
Cron sends 1h reminder to both parties
        ↓
At scheduled time — both tap "Join"
        ↓
Consultation session opens (chat / audio / video)
        ↓
Doctor issues prescription (optional)
Doctor requests lab test (optional)
Doctor schedules follow-up (optional)
Doctor ends consultation + saves notes
        ↓
Patient receives summary notification
Platform records earnings, deducts commission
Doctor's net earning added to payout balance
        ↓
Patient rates and reviews the doctor
```

---

### 7.2 Complete Lab Test (Home Visit) Flow

```
Doctor requests lab test OR patient self-requests
        ↓
Patient selects home visit + pays
        ↓
Lab receives request
Lab assigns field agent
        ↓
Patient notified: "Agent will visit on [date/time]"
Field agent sees visit in schedule
        ↓
Field agent travels to patient address
Field agent taps "Mark Sample Collected"
        ↓
Lab sees status = Collected
Lab processes sample
Lab uploads result file
        ↓
Patient notified: "Your results are ready"
Doctor can view results in consultation
```

---

### 7.3 Complete Pharmacy Order Flow

```
Doctor issues prescription
        ↓
Patient receives prescription notification
Patient taps "Forward to Pharmacy"
        ↓
Patient selects pharmacy partner
Patient confirms order + pays
        ↓
Pharmacy partner sees new order
Pharmacy processes: Pending → Processing → Ready → Dispatched → Delivered
        ↓
Patient notified at each status change
Patient receives order
```

---

### 7.4 Emergency Triage Flow

```
Patient runs symptom checker
        ↓
Score ≥ 30 → RED classification
        ↓
Immediate actions (all simultaneous):
  • Emergency push notification sent to patient
  • Emergency email sent with 199/112 contacts
  • SMS alert sent to patient phone
  • Nearest emergency facility shown on screen
        ↓
Patient taps facility for directions
Platform logs the triage event
```

---

### 7.5 Doctor Payout Flow

```
Doctor completes consultations → earnings accumulate
        ↓
Doctor goes to Earnings → taps "Request Payout"
        ↓
Admin sees pending payout request
Admin verifies bank details + amount
Admin approves request
        ↓
Paystack transfer initiated (or manual transfer logged)
Doctor receives notification: "Payout of ₦X approved"
Payout marked as disbursed in earnings history
```

---

## Summary: Entry Points by Role

| Role             | Web Login →           | Mobile Login →           |
| ---------------- | --------------------- | ------------------------ |
| Patient          | `/patient`            | `/(tabs)`                |
| Doctor           | `/doctor`             | `/(doctor)`              |
| Pharmacy Partner | `/partner/pharmacy`   | `/(partner)`             |
| Lab              | `/partner/lab`        | `/(partner)`             |
| Field Agent      | — (web not available) | `/(field_agent)`         |
| Admin            | `/admin`              | — (mobile not available) |

---

## Notification Triggers (All Roles)

| Event                        | Patient              | Doctor  | Partner | Field Agent | Admin |
| ---------------------------- | -------------------- | ------- | ------- | ----------- | ----- |
| Appointment booked           | ✓ email + push       | ✓ push  | —       | —           | —     |
| Appointment 24h reminder     | ✓ email + push       | ✓ push  | —       | —           | —     |
| Appointment 1h reminder      | ✓ email + push       | ✓ push  | —       | —           | —     |
| Consultation ended           | ✓ push               | —       | —       | —           | —     |
| Prescription issued          | ✓ email + push       | —       | —       | —           | —     |
| Pharmacy order status change | ✓ push               | —       | ✓ push  | —           | —     |
| Lab result uploaded          | ✓ email + push       | —       | —       | —           | —     |
| Sample collected             | ✓ push               | —       | ✓ push  | —           | —     |
| Red triage alert             | ✓ email + SMS + push | —       | —       | —           | —     |
| KYC approved                 | —                    | ✓ email | ✓ email | —           | —     |
| Payout approved              | —                    | ✓ push  | ✓ push  | —           | —     |
| New order/request            | —                    | —       | ✓ push  | —           | —     |
| Visit assigned               | —                    | —       | —       | ✓ push      | —     |

---

_Last updated: 2026-08-10_
