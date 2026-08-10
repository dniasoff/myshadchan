export const englishCrmMessages = {
  resources: {
    shidduchim: {
      name: "Shidduch |||| Shidduchim",
      forcedCaseName: "Shidduch",
      fields: {
        name_en: "Name",
        single_id: "Single",
        shadchan_id: "Shadchan",
        seminary_en: "Yeshiva / seminary",
        location_en: "Location",
        father_en: "Father",
        mother_en: "Mother",
        shul_en: "Shul",
        age: "Age",
        height: "Height",
        dob: "Date of birth",
        background: "Background",
        marital_status: "Marital status",
        existing_children_note: "Existing children",
        redt_date: "Redt date",
        pipeline_state: "State",
      },
    },
    singles: {
      name: "Single |||| Singles",
      forcedCaseName: "Single",
      fields: {
        first_name_en: "First name",
        last_name_en: "Last name",
        community: "Community",
        status: "Status",
        gender: "Gender",
      },
    },
    shadchanim: {
      name: "Shadchan |||| Shadchanim",
      forcedCaseName: "Shadchan",
      fields: {
        name: "Name",
        location: "Location",
        responsiveness: "Responsiveness",
      },
    },
    references: {
      name: "Reference |||| References",
      forcedCaseName: "Reference",
      fields: {
        name_en: "Name",
        relationship: "Relationship",
        phone: "Phone",
        school: "School",
        grad_year: "Graduation year",
        linked_shidduchim_count: "Linked singles",
        contacted_count: "Contacted",
        last_conversation_at: "Last conversation",
        open_task_count: "Open reminders",
      },
    },
    members: {
      name: "User |||| Users",
      fields: {
        first_name: "First name",
        last_name: "Last name",
        email: "Email",
        administrator: "Admin",
        disabled: "Disabled",
      },
      edit: {
        error: "An error occurred. Please try again.",
        record_not_found: "Record not found",
        success: "User updated successfully",
        title: "Edit %{name}",
      },
      remove: {
        label: "Remove from household",
        confirmTitle: "Remove from household",
        confirmDescription:
          "This will remove {name} from this household. They will stay in your family's records and you can undo this at any time.",
        cancel: "Cancel",
        confirm: "Remove",
        removing: "Removing...",
        success: "Person removed from household",
        error: "Could not remove person. Try again.",
      },
    },
    tasks: {
      name: "Task |||| Tasks",
      forcedCaseName: "Task",
      fields: {
        text: "Description",
        due_date: "Due date",
        type: "Type",
        due_short: "due",
      },
      action: {
        edit: "Edit task",
      },
      actions: {
        postpone_next_week: "Postpone to next week",
        postpone_tomorrow: "Postpone to tomorrow",
        title: "task actions",
      },
      deleted: "Task deleted successfully",
      sheet: {
        edit: "Edit task",
      },
      empty_list_hint: "Tasks you add will appear here.",
      filters: {
        later: "Later",
        overdue: "Overdue",
        this_week: "This week",
        today: "Today",
        tomorrow: "Tomorrow",
      },
      updated: "Task updated",
    },
  },
  crm: {
    auth: {
      footer_private: "Private to your family",
      back_to_home: "Back to home",
      login: {
        title: "Welcome back",
        subtitle: "Sign in to your records.",
        send_code: "Send code",
        code_sent_to: "We sent a 6-digit code to %{email}.",
        code_label: "Code",
        resend_code: "Resend code",
        code_resent: "Code sent again",
        use_different_email: "Use a different email",
        invalid_code: "That code is incorrect or has expired.",
        // Google sign-in entry point + the link to the open register flow
        // (RegisterFlow) — both previously built but wired into nothing.
        continue_with_google: "Continue with Google",
        or_divider: "or",
        no_account: "Don't have an account?",
        create_account: "Create one",
      },
      // GoogleSignInButton's own inline email + age-affirmation step, shown
      // after "Continue with Google" is clicked (signInWithOAuth() redirects
      // before anything about the visitor is known, so this has to be
      // collected first — see the component's own doc comment).
      google_step: {
        email_label: "Email",
        email_required: "Enter your email to continue.",
        preparing: "One moment…",
        back: "Back",
      },
      google_oauth_not_configured:
        "Google sign-in is not configured. Ask an administrator to enable and configure the Google provider in Supabase.",
      // oauthCallback.ts's own mapped, calm messages for a rejected OAuth
      // redirect. AuthCallback (components/admin/authentication.tsx)
      // translates the thrown error's message with the message itself as
      // its own fallback, so these catalogue entries — not the strings in
      // oauthCallback.ts — are what a turned-away visitor actually sees.
      oauth_callback: {
        cancelled:
          "You closed the Google sign-in window before finishing. No account was created — come back and try again whenever you're ready.",
        not_configured:
          "Google sign-in isn't available right now. Please sign in with your email instead.",
        generic:
          "We couldn't complete that sign-in. Please try again, or use your email instead.",
      },
      // The open self-service signup path (/register, RegisterFlow) — the
      // counterpart to crm.auth.login.* above, now that the invite gate is
      // gone (20260804214603_open_signup.sql).
      register: {
        title: "Create your account",
        subtitle: "It only takes a minute.",
        email_required: "Enter your email to continue.",
        sending_code: "Sending your code…",
        have_account: "Already have an account?",
        sign_in: "Sign in",
      },
      // Story 2.7: the invite-only signup flow (/accept-invite/:token).
      // There is no separate email/password form — the invitee only
      // affirms 18+ (crm.auth.age_affirmation.* below) and completes 2.6's
      // OTP verify.
      invite_title: "You've been invited",
      invite_body: "Join %{accountName} on MyShadchan as a %{role}.",
      invite_sending_code: "Sending your code…",
      invite_expired_title: "This invite has expired",
      invite_expired_body: "Ask the person who invited you for a new one.",
      invite_accepted_title: "This invite has already been used",
      invite_accepted_body:
        "Sign in instead, or ask the person who invited you for a new invite.",
      invite_revoked_title: "This invite has been revoked",
      invite_revoked_body: "Ask the person who invited you for a new one.",
      invite_not_found_title: "This invite link isn't valid",
      invite_not_found_body:
        "Ask the person who invited you to send a new one.",
      age_affirmation: {
        title: "Before you begin",
        body: "MyShadchan holds private, sensitive family records. It's built for parents and guardians managing the shidduchim process on behalf of their household.",
        checkbox: "I confirm I am 18 years of age or older.",
        continue: "Continue",
      },
      // 2.3 (AC-10): the onboarding persona multi-select. The other
      // `crm.auth.onboarding.*` keys FirstRunSetup/OnboardingChoice read
      // (account_title, single_title, done_body, etc.) predate this story
      // and run on inline defaults only — out of this story's scope to
      // back-fill (2-3-onboarding-persona-multi-select.md Dev Notes).
      onboarding: {
        persona_title: "Which applies to you?",
        persona_subtitle:
          "Pick everything that applies — you can add more later from Settings.",
        persona_single: "I'm looking for a shidduch for myself",
        persona_parent: "I'm looking for a shidduch for my children",
        persona_shadchan: "I'm a matchmaker (shadchan)",
        persona_validation: "Pick at least one to continue.",
        persona_done_shadchan_body: "Your shadchanus book is ready.",
      },
      footer: {
        terms: "Terms of Service",
        privacy: "Privacy Policy",
        subprocessors: "Sub-processors",
      },
    },
    landing: {
      nav: {
        sign_in: "Sign in",
      },
      hero: {
        eyebrow: "Shidduchim record",
        title_lead: "A record of the shidduch process",
        title_accent: "for your singles.",
        lead: "Suggestions, shadchanim, reference calls and dates, kept in one place.",
        cta: "Sign in",
        cta_secondary: "What it does",
        note: "Records are held per family. They are not shared with other families.",
      },
      what: {
        eyebrow: "What it does",
        title_lead: "The software stores",
        title_accent: "resumes, calls, dates and decisions.",
        resumes: {
          title: "Resumes",
          body: "Resumes arrive by message, email, photo, or on paper and scanned in. Each is stored and filed against the single it was suggested for.",
        },
        repeats: {
          title: "Repeat suggestions",
          body: "When a name is entered that has been suggested before, the earlier suggestion and the decision are shown.",
        },
        references: {
          title: "Reference calls",
          body: "Each reference call records who was spoken to, what they said, and which questions have not been asked.",
        },
        status: {
          title: "Status",
          body: "Each suggestion has one of seven states, from new through to a decision.",
        },
        states_caption: "The seven states",
      },
      how: {
        eyebrow: "How it works",
        title_lead: "Three steps,",
        title_accent: "from a resume to a decision.",
        enter: {
          title: "Enter the resume",
          body: "A resume is entered against a single. If that name has been suggested before, the earlier suggestion is shown at that point.",
        },
        record: {
          title: "Record what happens",
          body: "Reference calls, notes and dates are added to the suggestion as they take place.",
        },
        state: {
          title: "Set the state",
          body: "The suggestion moves between the seven states until a decision is recorded.",
        },
      },
      privacy: {
        eyebrow: "Your data",
        title_lead: "Records are stored",
        title_accent: "per family.",
        pooled: {
          title: "Not pooled",
          body: "Records are held per family. They are never pooled with other families, and no one's records are used to suggest anything to anyone else.",
        },
        directory: {
          title: "Private by default",
          body: "Nothing is discoverable unless you publish it. Families are never listed. A shadchan or a single may choose to publish a limited profile, and can withdraw it at any time.",
        },
        export: {
          title: "Export and deletion",
          body: "All data can be exported or deleted at any time.",
        },
      },
      openness: {
        eyebrow: "Code and cost",
        title_lead: "The code is public.",
        title_accent: "The service is free.",
        code: {
          title: "Code",
          body: "The code is public. It can be read, audited and self-hosted, and becomes fully open source two years after each release.",
        },
        cost: {
          title: "Cost",
          body: "The service is free. It is run at cost, not for profit.",
        },
      },
      closing: {
        title_lead: "Sign in",
        title_accent: "to the record.",
        lead: "Accounts are created with an email address.",
        cta: "Sign in",
      },
      footer: {
        note: "The code is public. The service is free, run at cost.",
        terms: "Terms of Service",
        privacy: "Privacy Policy",
        subprocessors: "Sub-processors",
      },
    },
    common: {
      added: "added",
      load_more: "Load more",
      misc: "Misc",
      copied: "Copied!",
    },
    // Story 4.1 — EntityListView's generic error block, shared by every
    // roster-style list `EntityList` renders (AC 6). Entity-specific list
    // copy (eyebrow/subtitle/empty state/no-matches) lives under each
    // entity's own `crm.<entity>.list.*` namespace below, not here.
    entity_list: {
      error: "Something went wrong loading this list.",
      retry: "Try again",
      // Story 4.2 — EntityListViewToggle's two accessible names (AC 2).
      view_list: "List view",
      view_cards: "Cards view",
      // Adversarial-review fix — groups the two buttons above as one
      // segmented control for assistive tech (`role="group"`'s label).
      view_mode: "View mode",
    },
    image_editor: {
      change: "Change",
      drop_hint: "Drop a file to upload, or click to select it.",
      editable_content: "Editable content",
      title: "Upload and resize image",
      update_image: "Update Image",
    },
    // Story 2.4: switching which context (household vs. shadchanus) is
    // active — a different axis from resources.singles above.
    context_switcher: {
      label: "%{name} · %{kind}",
      kind_household: "Household",
      kind_shadchanus: "Shadchanus",
      switch_error: "Couldn't switch context. Try again.",
      load_error: "Couldn't load your contexts.",
      section_title: "Context",
      trigger_label: "Switch context: %{context}",
    },
    // TopBar.tsx's pre-existing single-switcher pill (a different axis from
    // context_switcher above — "which single's pipeline am I viewing").
    // Named here (2.4 review finding #10) once ContextSwitcher started
    // rendering an identical-looking pill directly beside it.
    single_switcher: {
      trigger_label: "Switch single: %{name}",
    },
    settings: {
      dark_mode_logo: "Dark Mode Logo",
      light_mode_logo: "Light Mode Logo",
      notes: {
        statuses: "Statuses",
      },
      // Story 7.2: the household's own default posture for a NEW thread's
      // `visibility` when `create_thread()` is called without an explicit
      // argument (AD-22; FR96/FR99) — settings/CommunicationSection.tsx.
      communication: {
        title: "Communication",
        default_visibility: "New conversations",
        default_visibility_hint: "Who can see a new conversation by default",
        visibility_open: "Open — everyone in the household",
        visibility_private: "Private — only participants",
        save_error: "Couldn't save that. Try again.",
        // Story 7.5 (Task 7) — the push opt-in's own copy.
        // settings/CommunicationSection.tsx's PushNotificationsItem.
        push: {
          title: "Push notifications",
          description:
            "Get a notification on this device when someone sends a message in a discussion you're part of.",
          delivery_notice:
            "This only turns on this device's side. Delivery is not live yet, so you will not actually receive anything until it is switched on.",
          enable: "Enable on this device",
          enabling: "Enabling…",
          enabled: "Enabled on this device",
          unsupported:
            "This browser does not support push notifications (common on iOS unless the app is installed as a Home Screen app).",
          demo: "Not available in this demo — there is no delivery behind it to enable.",
          denied_hint:
            "Notifications are blocked for this site. Allow them from your browser's site settings, then try again.",
        },
      },
      // Story 10.3 (Task 6): the inbound-forwarding address, surfaced so
      // the phone-less capture path is discoverable —
      // settings/CaptureSection.tsx. Grouped near `communication` here too:
      // both are about how things reach this account, not privacy or family
      // membership.
      capture: {
        title: "Capture by email",
        description:
          "Forward or CC any redt to this address — it lands in your own Inbox.",
        // Epic 11: the per-household address is now read from
        // accounts.inbound_email_token, not a shared VITE_INBOUND_EMAIL —
        // this explains what sharing it means before the household does.
        explanation:
          "Anyone who knows this address can send to it. Mail from a sender we don't recognize waits in Needs review until you confirm them.",
        copy: "Copy",
        copied: "Copied",
      },
      // Story 2.5: the "add or remove a persona at any time" section.
      // persona_add_error is the generic add_persona() failure; the
      // persona_remove_error_* keys map 1:1 to remove_persona()'s specific
      // guard messages (02_functions.sql) so Settings never shows raw
      // Postgres text. persona_remove_error_last_access is review finding
      // #1's added guard_persona_removal() guard.
      personas_title: "Personas",
      persona_add_error: "Couldn't set that up. Try again.",
      persona_remove_error_ask_admin:
        "This record is managed by your household admin — ask them to make this change.",
      persona_remove_error_only_persona:
        "You can't remove your only persona. Add another first.",
      persona_remove_error_last_access:
        "You're the only one who can still reach this account's records — add another member before removing this.",
      persona_remove_error_parent_guard:
        "Another admin needs to manage your household's other singles before you can remove this.",
      persona_remove_error_generic: "Couldn't remove that. Try again.",
      // Story 2.8: the "one screen sends every kind of household invite"
      // section. invites_role_* label the four MemberRole values invites.role
      // permits (self_manager excluded by design — see InvitesSection.tsx's
      // own header comment); invites_status_* label the four invites.status
      // values, including the client-computed 'expired' fold (AC-4).
      invites_title: "Invites",
      invites_email_label: "Email",
      invites_role_label: "Role",
      invites_role_parent_admin: "Parent / admin",
      invites_role_helper: "Helper",
      invites_role_single: "Single",
      invites_role_shadchan: "Shadchan",
      invites_send_button: "Send invite",
      invites_send_error: "Couldn't send that invite. Try again.",
      invites_copy: "Copy",
      invites_copied: "Copied",
      invites_empty: "No invites sent yet",
      invites_expires_in: "%{role} · expires %{when}",
      invites_status_pending: "Pending",
      invites_status_accepted: "Accepted",
      invites_status_revoked: "Revoked",
      invites_status_expired: "Expired",
      invites_revoke: "Revoke",
      invites_revoke_error: "Couldn't revoke that invite. Try again.",
      // Story 8.2: the consent-based connection workflow's Settings section
      // (ConnectionSection.tsx) — branches on the active context's kind, so
      // both the household and shadchan copy live under the same
      // connection_* namespace rather than two parallel ones.
      connection_title: "Connection",
      connection_household_description:
        "Connect with your family's shadchan so they can see your singles' shidduchim and redt directly.",
      connection_shadchan_description:
        "Connect with a family so you can see their shidduchim and redt directly.",
      connection_connect_shadchan: "Connect with a shadchan",
      connection_connect_family: "Connect with a family",
      connection_generate_error: "Couldn't create that invite link. Try again.",
      connection_end_button: "End connection",
      connection_end_error: "Couldn't end that connection. Try again.",
      connection_active_status: "Connected",
      connection_ended_status: "Connection ended",
      // Review finding F8: revoke_connection_invite() and its dataProvider
      // mirrors existed with no UI calling them — a leaked invite link had
      // no shipped way to be killed before its 7-day expiry.
      connection_invite_pending_label: "Invite link pending",
      connection_invite_expires: "Expires %{when}",
      connection_invite_cancel: "Cancel invite",
      connection_invite_revoke_error: "Couldn't cancel that invite. Try again.",
      // Story 9.1: the "Publish my listing" settings panel
      // (listings/PublishShadchanListingSection.tsx) — field-by-field
      // opt-in (AC-1), name required to publish (AC-2), and withdrawal
      // (AC-5).
      listing: {
        title: "Publish my listing",
        description:
          "Choose what families can find about you, field by field. Nothing is shown until you turn it on.",
        name_label: "Name",
        name_placeholder: "How families should see your name",
        area_label: "Area",
        area_placeholder: "e.g. Lakewood and nearby",
        contact_label: "How to reach me",
        contact_placeholder:
          "Phone, email, or however you prefer to be reached",
        name_required_error:
          'Turn on "Name" and enter a name before publishing.',
        publish_button: "Publish my listing",
        update_button: "Update listing",
        publish_success: "Your listing is live.",
        publish_error: "Couldn't publish your listing. Try again.",
        withdraw_button: "Withdraw listing",
        withdraw_success: "Your listing has been withdrawn.",
        withdraw_error: "Couldn't withdraw your listing. Try again.",
        // Story 9.3: consent_to_republish_listing() — shown only to the
        // single themselves, only when their own withdrawal-lock row
        // exists (ConsentToRepublishButton.tsx).
        consent_button: "Allow republishing",
        consent_success: "You've consented — this listing can be republished.",
        consent_error: "Couldn't process your consent. Try again.",
      },
      // Story 9.2: the "Single listings" settings section
      // (settings/SingleListingSection.tsx) — the per-single roster and its
      // Publish / Manage listing action, gated to who FR103 lets act.
      single_listing: {
        title: "Single listings",
        description:
          "Publish a narrow, opt-in profile so shadchanim can find them.",
        empty: "No singles in this household yet.",
        publish_button: "Publish",
        manage_button: "Manage listing",
        dialog_title: "Publish a listing for %{name}",
        // Story 9.5 — the "Share" action per row, opening
        // sharing/ShareSingleDialog.tsx (a SEPARATE surface from Publish).
        share_button: "Share",
      },
      // Story 9.2: the field-by-field publish form itself
      // (listings/PublishSingleListingSection.tsx) — field-by-field opt-in
      // (AC-1), at least one first name required to publish (AC-2).
      single_listing_form: {
        first_name_en_label: "First name (English)",
        first_name_en_placeholder: "How shadchanim should see their first name",
        first_name_he_label: "First name (Hebrew)",
        first_name_he_placeholder: "שם פרטי",
        age_label: "Age",
        age_placeholder: "e.g. 24",
        height_label: "Height",
        height_placeholder: "e.g. 5'6\"",
        community_label: "Community",
        community_placeholder: "e.g. Yeshivish, Modern Orthodox",
        location_label: "Location",
        location_placeholder: "e.g. Lakewood, NJ",
        summary_label: "Summary",
        summary_placeholder: "Anything the fixed fields above don't capture",
        name_required_error:
          "Turn on an English or Hebrew first name and enter it before publishing.",
        publish_button: "Publish listing",
        update_button: "Update listing",
        publish_success: "The listing is live.",
        publish_error: "Couldn't publish the listing. Try again.",
        // Story 9.3 (AC-2): the honest refusal shown when a publish/
        // republish attempt is blocked by the single's own withdrawal lock
        // — never a generic "not authorized" error.
        locked_error:
          "This single withdrew this listing and must consent again before it can be republished.",
      },
      reset_defaults: "Reset to Defaults",
      save_error: "Failed to save configuration",
      saved: "Configuration saved successfully",
      saving: "Saving...",
      tasks: {
        types: "Types",
      },
      preferences: "Preferences",
      title: "Settings",
      app_title: "App Title",
      sections: {
        branding: "Branding",
      },
      validation: {
        duplicate: "Duplicate %{display_name}: %{items}",
        in_use: "Cannot remove %{display_name} that are still in use: %{items}",
        validating: "Validating\u2026",
        entities: {
          categories: "categories",
          stages: "stages",
        },
      },
      privacy: {
        terms_link: "Terms of Service",
        privacy_link: "Privacy Policy",
        subprocessors_link: "Sub-processors",
      },
    },
    theme: {
      dark: "Dark",
      label: "Theme",
      light: "Light",
      system: "System",
    },
    language: "Language",
    navigation: {
      label: "CRM navigation",
      // Story 8.1 (AC-1/Task 2): the one SHADCHANUS_NAV entry with no
      // household-nav precedent to fall back on — PRIMARY_NAV's own labels
      // (inbox, shidduchim, tasks, reminders) rely on labelDefault via
      // i18nProvider's allowMissing, so this is deliberately the first real
      // catalogue entry under `navigation`.
      connections: "Connections",
    },
    // Story 4.5: the one search overlay reachable from every screen
    // (TopBar's icon, Cmd/Ctrl+K, and MobileNavigation's "More" menu item —
    // AC-1). `hint`/`placeholder` are the user-facing list of what is
    // searchable and must NOT name references (RULING 7, AC-2).
    global_search: {
      trigger_label: "Search",
      title: "Search",
      description: "Search singles, shidduchim and shadchanim",
      placeholder: "Search singles, shidduchim, shadchanim…",
      hint: "Search singles, shidduchim, shadchanim…",
      loading: "Searching…",
      no_results: "No results",
      // Review F5: one resource's getList rejecting must surface, not
      // silently render as an empty, indistinguishable "No results".
      error: "Something went wrong while searching. Please try again.",
      partial_error: "Some results may be missing — part of the search failed.",
    },
    profile: {
      title: "Profile",
      updated: "Your profile has been updated",
      update_error: "An error occurred. Please try again",
    },
    // Story 3-10 (tab vocabulary). One entry per TabKey (entity360/tabKeys.ts)
    // — values identical to TAB_LABELS's, so the two never drift silently
    // behind i18nProvider's `allowMissing: true` (Epic 3 API contract §3
    // rule 2). Adding a tab key adds one entry here in the same diff.
    entity360: {
      tab: {
        overview: "Overview",
        activity: "Activity",
        notes: "Notes",
        tasks: "Tasks",
        files: "Files",
        related: "Related",
        resume: "Resume",
        photo: "Photo",
        medical: "Medical",
        diligence: "Diligence",
        "external-links": "External links",
        shidduchim: "Shidduchim",
        conversations: "Conversations",
        discussions: "Discussions",
        assistant: "Assistant",
      },
      overview: {
        empty: "No details on file yet.",
        // Story 6.4 — SingleInputForm.tsx, mounted above ShidduchCatchSection
        // in ShidduchOverviewTab.tsx. Deliberately its own namespace, not
        // `rail.singleInput` above: that one is the read-only feed's own
        // UX-DR11 states; this is the write form's, a different surface
        // (Ruling 2 — the rail never mutates).
        singleInput: {
          heading: "Share your input",
          placeholder: "What do you think of this suggestion?",
          submit: "Send",
          error: "Failed to send your input",
        },
      },
      // Story 3-10 Task 6 / Story 3.3b — RelatedRecordsTab's own pending /
      // error / empty states (UX-DR11).
      related: {
        loading: "Loading…",
        error: "Could not load related records.",
        empty: "Nothing here yet.",
      },
      // Story 3.5 — interactionLabels.ts's INTERACTION_KIND_LABELS. One
      // entry per InteractionKind, replacing the two duplicated maps that
      // used to live in per-entity timeline components: the shidduch
      // pipeline's own timeline was folded into ActivityTab by Story 5.1,
      // and ReferenceTimeline.tsx (the other one) was deleted the same way
      // by Story 5.10.
      // `empty` / `error` / `viewRecord` are ActivityTab.tsx's own UX-DR11
      // states and AC 9 mention link text — catalogued here so French users
      // get a real translation rather than always falling through to the
      // `_:` English fallback.
      activity: {
        kind: {
          note: "Note",
          call_logged: "Call logged",
          status_change: "Status changed",
          merge: "Merged",
          link_created: "Linked to a shidduch",
          link_removed: "Unlinked from a shidduch",
          single_input: "The single's input",
        },
        empty: "Nothing logged yet.",
        error: "Could not load the activity feed.",
        viewRecord: "View record",
      },
      // Story 3.6 — NotesTab.tsx's own UX-DR11 states, its add/edit/delete
      // controls, and the author fallback for a note whose author's
      // membership has since left the account (interactions_summary.author_name
      // resolves to null in that case).
      notes: {
        empty: "No notes yet.",
        error: "Could not load the notes.",
        placeholder: "Add a note…",
        add: "Add note",
        edit: "Edit",
        delete: "Delete",
        save: "Save",
        cancel: "Cancel",
        unknownAuthor: "Unknown",
        addError: "Failed to add the note",
        editError: "Failed to update the note",
        deleteError: "Failed to delete the note",
      },
      // Story 3.8 — TasksTab.tsx and TasksRailSummary.tsx's own UX-DR11
      // states, TasksTab's add/toggle controls (Ruling 2 — TasksTab is the
      // only component in the codebase that mutates tasks from a 360), and
      // TasksRailSummary's link into the tab.
      tasks: {
        empty: "No tasks yet.",
        error: "Could not load the tasks.",
        placeholder: "Add a task…",
        dueDate: "Due date",
        add: "Add task",
        addError: "Failed to add the task",
        toggleError: "Failed to update the task",
        viewAll: "See all tasks",
      },
      // Story 3.7 — FilesTab.tsx's own UX-DR11 states, its upload/replace/
      // delete controls, and the per-row visibility control (rendered only
      // for shidduch/single targets, matching
      // entity_files_visibility_target_check).
      files: {
        empty: "No files yet.",
        error: "Could not load the files.",
        upload: "Upload a file",
        uploadError: "Failed to upload the file",
        download: "Download",
        downloadError: "Failed to get a download link",
        replace: "Replace",
        replaceError: "Failed to replace the file",
        delete: "Delete",
        deleteError: "Failed to delete the file",
        visibility: "Visibility",
        visibilityError: "Failed to update visibility",
        visibilityOption: {
          shared: "Shared",
          private_parent: "Parents only",
          private_single: "Single only",
        },
      },
      // Story 5.3 — ResumeTab's own UX-DR11 states and its upload/download
      // controls. No visibility control (a resume has none) and no replace
      // (a resume is versioned by appending, never replacing — AC 2).
      resume: {
        empty: "No resume uploaded yet.",
        error: "Could not load the resume.",
        upload: "Upload a new version",
        uploadError: "Failed to upload the resume",
        download: "Download",
        downloadError: "Failed to get a download link",
      },
      // Story 5.4 — PhotoTab.tsx's own UX-DR11 states, its upload control's
      // visibility radio group (resume_photos' narrower subset of
      // ShidduchVisibility — no `private_single`, see the story's own
      // reasoning), and PhotoRevealCard's reveal-then-show / hide controls.
      photo: {
        empty: "No photos uploaded yet.",
        error: "Could not load the photos.",
        upload: "Upload a photo",
        uploadError: "Failed to upload the photo",
        reveal: "Reveal",
        revealError: "Failed to reveal the photo",
        hide: "Hide",
        hideError: "Failed to hide the photo",
        alt: "Photo",
        visibilityOption: {
          shared: "Shared",
          private_parent: "Parents only",
        },
      },
      // Story 5.5 — MedicalTab.tsx's own UX-DR11 states and its add-a-note
      // form. No edit/delete control (no AC asks for one) and no visibility
      // option (the tab itself is restricted to parent_admin/self_manager by
      // `visibleTo` — every note within it is visible to both, uniformly).
      medical: {
        empty: "No medical notes yet.",
        error: "Could not load the medical notes.",
        placeholder: "Add a medical note…",
        add: "Add note",
        addError: "Failed to add the note",
      },
      // Story 5.6 — ExternalLinksTab.tsx's own UX-DR11 states, its add/
      // remove controls, and the invalid-URL rejection message (AC 4).
      "external-links": {
        empty: "No external links yet.",
        error: "Could not load the external links.",
        urlPlaceholder: "https://example.com/profile",
        labelPlaceholder: "Label (optional)",
        add: "Add link",
        addError: "Failed to add the link",
        invalidUrl: "Enter a valid URL (including https://).",
        remove: "Remove",
        removeError: "Failed to remove the link",
      },
      // Story 5.7 — the shidduch right rail: `SingleInputPanel`'s own
      // UX-DR11 states (a read-only feed of `kind = 'single_input'`
      // interactions) and `ForwardResumeButton`'s disabled-tooltip and
      // failure copy (Ruling 2 — the rail never mutates; only the states a
      // read-only panel and a download/share action need).
      rail: {
        singleInput: {
          heading: "The single's input",
          empty: "Nothing has been shared yet.",
          error: "Could not load the single's input.",
        },
        reminders: {
          heading: "Reminders",
        },
        forward: {
          action: "Forward resume",
          noResume: "No resume to forward yet.",
          error: "Failed to forward the resume",
        },
      },
      // Story 3.2 — ShowBase's explicit `loading` / `error` elements (AC 2).
      record_pending: "Loading…",
      record_unavailable: "This record is unavailable.",
      record_unavailable_link: "Back to the list",
      // RULING 7 — a no-browse entity (`descriptor.browsable === false`) has
      // no list to go back to; RecordUnavailable offers the dashboard.
      record_unavailable_home_link: "Back to the dashboard",
      // Story 3.4 AC 6(a) — replaces the tab bar and tab content while the
      // viewer's role in the active context is still resolving.
      role_pending: "Loading your access…",
    },
    // Story 4.1 — the singles roster's own copy, read via `useTranslate` at
    // the `SingleList` call site and handed pre-translated into
    // `EntityListHeader` / `EntityList`'s `emptyState` (AD-18: no hardcoded
    // strings lost when the bespoke header/skeleton moved onto `EntityList`).
    singles: {
      list: {
        eyebrow: "Family roster",
        subtitle:
          "Every single you are redting for, each with their own pipeline.",
        createLabel: "Add a single",
        searchPlaceholder: "Search by name",
        emptyTitle: "Add your first single",
        emptyDescription:
          "A shidduchim pipeline belongs to a single — the person you are redting for. Add a single to start tracking suggestions.",
        // Story 6.5 (AC 4): shown instead of `subtitle`/`emptyDescription`
        // above when the viewer holds the `single` persona WITHOUT `parent`
        // (SingleList.tsx) — a self-manager's own pipeline is their own, not
        // someone else's they are redting for.
        subtitleSelfManaged: "Your own shidduchim pipeline, all in one place.",
        emptyDescriptionSelfManaged:
          "This is where your own shidduchim pipeline will live. Add your record to start tracking suggestions.",
        noMatches: "No singles match this search.",
        filter: {
          past: "Past members",
        },
      },
      // Story 6.1 (AC 1) — SingleLoginInvite.tsx's own copy: the one entry
      // point that gives a single their own login, mounted on the record
      // itself. linkedIndicator replaces the action once member_id is set.
      loginInvite: {
        action: "Give %{name} their own login",
        description:
          "%{name} will be able to sign in and see what you share with them.",
        emailLabel: "Email",
        sendButton: "Send invite",
        sendError: "Couldn't send that invite. Try again.",
        linkedIndicator: "Has their own login",
      },
    },
    // Story 4.1 — the shadchan book's own copy, same shape as `singles`
    // above.
    shadchanim: {
      list: {
        eyebrow: "Matchmaker book",
        subtitle:
          "Every matchmaker your family has worked with, in one calm book.",
        createLabel: "Add a shadchan",
        searchPlaceholder: "Search by name",
        emptyTitle: "Add your first shadchan",
        emptyDescription:
          "Every redt comes from somewhere — keep a book of the matchmakers your family works with.",
        noMatches: "No shadchanim match this search.",
      },
      // Story 4.2, AC 5 — `ShadchanRow`'s count label. AD-23 vocabulary
      // ("shidduchim"), never "suggestion(s)". Story 5.9 pointed
      // `ShadchanCard.tsx`'s own count label at this same key, retiring its
      // last "suggestion"/"suggestions" text.
      row: {
        shidduchimCount:
          "%{smart_count} shidduch |||| %{smart_count} shidduchim",
      },
    },
    // Story 4.3, AC 1 — ShidduchimViewSwitch's three-position control, the
    // segmented-toggle counterpart to `entity_list.view_list`/`view_cards`
    // above, plus a third "board" position `entity_list` has no equivalent
    // for.
    shidduchim: {
      pageView: {
        label: "Pipeline view",
        board: "Board view",
        list: "List view",
        cards: "Cards view",
      },
    },
    references: {
      // RULING 7 — the reference book is gone; `#/references` is the
      // unattached-references index. These keys replaced `list.*`.
      index: {
        eyebrow: "Needs a shidduch",
        title: "Unattached references",
        subtitle:
          "People recorded without a shidduch. Attach each one to the shidduch you spoke to them about, and they will be reached from there instead.",
        empty:
          "Nothing to sort out — every reference belongs to a shidduch. References are reached from the shidduch they were asked about, never browsed on their own.",
        emptyLink: "Go to the pipeline",
      },
      attach: {
        action: "Attach to a shidduch",
        title: "Attach to a shidduch",
        description:
          "%{name} is not part of any shidduch yet. Pick the one you spoke to them about.",
        noShidduchim: "There are no shidduchim to attach this person to yet.",
        done: "Attached. This person now belongs to a shidduch.",
      },
      create: {
        requires_shidduch:
          "A reference can only be created from inside a shidduch.",
        requires_shidduch_link: "Go to the pipeline",
        linked: "Reference saved and linked to this shidduch.",
      },
      header: {
        progress: "%{contacted} of %{total} conversations done",
        relationshipNote: "Shown per single below when it differs.",
      },
      shidduch: {
        empty: "Nobody has been asked about this single yet.",
        add: "Add a reference",
        firstConversation: "First conversation",
        repeatConversation: "Spoken to before",
      },
      match: {
        title: "You may have spoken to this person before",
        subtitle:
          "Linking keeps everything you already know about them in one place.",
        confirm: "Yes, this is %{name}",
        dismiss: "No, different person",
        why: "Why we think so",
        alreadyLinked: "Already linked to %{smart_count} other singles",
        linked: "Linked to the person you already know.",
        confidence: {
          strong: "Strong match",
          likely: "Likely match",
          possible: "Possible match",
        },
      },
      callStatus: {
        not_started: "Not started",
        answered: "Answered",
        no_answer: "No answer",
        call_back: "Call back",
        they_will_call_back: "They will call back",
      },
      call: {
        about: "About %{name}",
        howDidItGo: "How did the call go?",
        questionsTitle: "Questions to ask",
        questionsToggle: "Show questions",
        questionsToggleHide: "Hide questions",
        whatTheySaid: "What they said",
        placeholder: "Type as much or as little as you like.",
        save: "Save and add to log",
        saved: "Saved to the call log.",
        onACall: "On a call",
      },
      callLog: {
        unlinked: "Not linked to a single",
        nothingYet: "Nothing recorded from this conversation yet.",
        entries: "%{smart_count} log entries",
        viaAssistant: "via the call script",
        capture: "Log a call",
        empty: "This person is not linked to any single yet.",
      },
      callMode: {
        launch: "Call mode",
        coverage: "%{done} of %{total} covered",
        askThem: "Ask them",
        comingUp: "Coming up",
        answerPlaceholder: "Type their answer here…",
        saveNext: "Save and next",
        skip: "Skip",
        askedBefore: "Already asked",
        alreadyLogged: "%{smart_count} answers already logged",
        wrapTitle: "Finish call",
        callBack: "Not finished — call back",
        end: "End call",
        guardrail:
          "Call mode helps you not miss a question; it never judges whether this is a good match.",
        stepOf: "Step %{current} of %{total}",
      },
      repeat: {
        none: "No other conversations with this person yet.",
        title: "You have spoken to %{name} about %{smart_count} other singles",
        progress: "%{contacted} of %{total} of those conversations happened",
      },
      merge: {
        action: "Merge duplicates",
        title: "Merge into this person",
        description:
          "Everything from the duplicate moves onto %{name}. This cannot be undone.",
        pick: "Which record is the duplicate?",
        noCandidates: "No likely duplicates found for this person.",
        keeping: "Keeping",
        removing: "Removing",
        moving:
          "%{links} linked singles, %{interactions} timeline entries and %{tasks} open reminders will move across.",
        collisionsTitle:
          "Both records have a call log for %{smart_count} of the same singles",
        keepWinner: "Keep the one being kept",
        keepLoser: "Keep the duplicate's",
        keepBoth: "Keep both",
        nothingRecorded: "Nothing recorded",
        nothingLost:
          "Whichever you choose, the other account of the call is kept on the timeline.",
        resolveFirst: "Resolve %{smart_count} conflicts first",
        confirm: "Merge, this cannot be undone",
        done: "The two records are now one.",
      },
      assistant: {
        title: "Research assistant",
        paid: "Paid",
        upsell:
          "Tailored questions for each reference, a guided call script, and a summary of what everyone agreed on and what is still missing.",
        guardrail:
          "This assistant organizes what you have learned. It never judges compatibility and never suggests a match.",
        questionsTitle: "Questions worth asking %{relationship}",
        captureHint:
          'Use "Log a call" on any linked single to capture the answers as you go.',
        // Story 11.3: the per-suggestion cross-reference summary moved to the
        // shidduch Diligence tab; the remaining assistant panel only shows
        // tailored questions.
      },
    },
    diligence: {
      dossier: {
        title: "Cross-reference summary",
        paid: "Paid",
        upsell:
          "See what everyone agreed on, where they differed, and what nobody was asked.",
        consensus: "Consensus",
        nothingRecorded: "Nothing recorded yet.",
        consensusDetail:
          "%{warm} spoke warmly, %{reserved} raised a reservation.",
        covered: "Covered",
        nothingCovered: "Nothing recorded yet.",
        gaps: "Still missing",
        noGaps: "Every topic has been touched on.",
        // Story 11-1 review fix (Finding 13): renamed from `contradiction`
        // ("References differ") to match `DossierResponse.hasMixedSentiment`
        // — the flag is a whole-corpus warm-vs-hesitant split, not a claim
        // that two references disagree on the same point.
        mixedSentiment: "Mixed sentiment",
        narrative: "Summary",
        error: "Could not load the summary. Please try again.",
        guardrail:
          "This summary organises what you have learned. It never judges compatibility or suggests a match.",
      },
    }, // Story 7.1 — the Discussions tab (ThreadList/ThreadPanel,
    // shidduchim/ShidduchDiscussionsTab). The tab's own LABEL is
    // `crm.entity360.tab.discussions` (already present); this block is the
    // tab's CONTENT strings, mirroring `shidduchim`/`references` above as
    // their own top-level namespace rather than nesting under `entity360`,
    // since ThreadList/ThreadPanel are a standalone domain (`threads/`), not
    // a universal tab component.
    threads: {
      list: {
        empty: "No discussions yet.",
        error: "Could not load the discussions.",
        start: "Start a discussion",
        startError: "Failed to start the discussion",
        rowOpen: "Open",
        rowPrivate: "Private",
      },
      panel: {
        empty: "No messages yet.",
        error: "Could not load the messages.",
        placeholder: "Write a message…",
        send: "Send",
        sendError: "Failed to send the message",
        // Story 7.5 (AC-1, AC-2) — markThreadRead()'s own failure copy.
        markReadError: "Failed to mark this discussion read",
      },
      // Story 7.3 — the lock/unlock control, participants only. The button
      // label states the CONSEQUENCE, not just the mechanism: a padlock icon
      // alone does not say "invisible to the rest of the household," which
      // is the point (Task 4).
      visibility: {
        lock: "Make private",
        lockDescription:
          "Only the people in this discussion will be able to see it — invisible to the rest of the household.",
        unlock: "Make open",
        unlockDescription:
          "Everyone in the household who can already see this discussion's topic will be able to read it.",
        updateError: "Failed to update this discussion's privacy",
      },
    },
    // RULING 7 — the account-wide "not yet spoken to" worklist the reference
    // book used to carry as its `contacted_count@eq: 0` filter, rehomed onto
    // the Reminders hub (`reminders/OutstandingCallsSection.tsx`).
    reminders: {
      outstandingCalls: {
        title: "Still to call",
        subtitle: "%{smart_count} conversations have not happened yet.",
        about: "about",
        overflow: "and %{smart_count} more",
      },
      // Story 12.1 (gap D1) — the dashboard's account-wide, read-only "Due
      // now" card (`dashboard/DueRemindersCard.tsx`). `since`/`due` mirror
      // `ReminderCard.tsx:82-84`'s own prefixes verbatim; `empty` reuses
      // `ReminderList.tsx:71`'s exact phrase so the hub and the dashboard
      // never develop two voices for the same state.
      dueCard: {
        title: "Due now",
        subtitle: "What's due across your family, soonest first.",
        empty: "Nothing due — you're on top of it",
        since: "Since %{when}",
        due: "Due %{when}",
        about: "about",
        overflow: "and %{smart_count} more",
        seeAll: "See all reminders",
      },
      // Story 12.2 (AC-9): the Settings → Preferences delivery heartbeat row
      // (`reminders/ReminderDeliveryStatus.tsx`). Anti-recurrence control — a
      // dead sweep and a healthy one must never look the same from inside
      // the app.
      deliveryStatus: {
        label: "Reminder emails",
        notSetUp: "Not set up yet",
        sending: "Sending",
        // Epic 12 review fix (R3): a fresh, non-stale heartbeat whose most
        // recent tick still failed to deliver at least one email — distinct
        // from "Sending" (which now means the sweep is alive AND nothing
        // recently failed) so a green-looking heartbeat can never again
        // stand in for a queue that is actually failing.
        failing: "Delivery failing",
        paused: "Paused",
        fetchError: "Couldn't check",
      },
    },
    // Story 12.3: family-shared tasks with assignees — the Everyone/Mine
    // scope toggle (`tasks/TaskScopeToggle.tsx`, shared by `/tasks` and
    // `/reminders`) and the assignee chip/picker
    // (`tasks/TaskAssigneeChip.tsx`, `tasks/TaskAssigneeSelect.tsx`).
    tasks: {
      assignee: {
        label: "Assignee",
        unassigned: "Unassigned",
        you: "You",
        everyone: "Everyone",
        mine: "Assigned to me",
        scope_group: "Task scope",
        former_member: "No longer in this household",
        reassign: "Reassign",
      },
    },
    validation: {
      invalid_url: "Must be a valid URL",
      invalid_linkedin_url: "URL must be from linkedin.com",
    },
    // Story 8.1 (AC-5/AC-6): shared copy for the shadchanus-context shell —
    // the eyebrow `ShadchanDashboard` shows above its heading.
    shadchanus_context: {
      eyebrow: "Shadchanus",
    },
    // Story 8.1 (AC-5) shipped title/empty_title/empty_description — Story
    // 8.5 (AC-7, Task 6) replaces the placeholder body but reuses this SAME
    // empty state verbatim, and adds the populated-state copy (stats,
    // recent-connections list) alongside it.
    shadchan_dashboard: {
      title: "Your shadchanus workspace",
      empty_title: "Nothing here yet",
      empty_description:
        "Once you connect with a family, their conversations will appear here.",
      stats: {
        connections: "Connections",
        unread: "Unread conversations",
      },
      recent_title: "Recently active connections",
      connectedSince: "Connected since %{date}",
    },
    // Story 8.2 (Task 6): the accept screen at /connect/:token, reached by
    // an ALREADY-authenticated user — see ConnectionAccept.tsx's own
    // header comment for why this differs from login/InviteAcceptance's
    // four distinct unavailable-invite messages (preview_connection_invite()
    // folds every non-open state into one empty result).
    connection_accept: {
      title: "Connect with %{name}",
      description: "%{name} would like to connect with you on MyShadchan.",
      accept_button: "Accept",
      invalid_title: "This invite link isn't valid",
      invalid_description:
        "It may have expired, already been used, or been revoked. Ask the person who sent it for a new one.",
      error: "Couldn't accept that invite. Try again.",
    },
    // Story 8.3 (Task 4): the inbox source label for a shadchan-originated
    // redt — the one new INBOX_SOURCE_META entry (inbox/inboxMeta.ts) routed
    // through the i18nProvider; the other five sources stay plain literal
    // text (see inboxMeta.ts's own comment).
    inbox: {
      source_shadchan: "Shadchan",
      senderNeedsConfirmation: "Who sent this?",
      // Epic 11: the two-tab split (inbox/InboxList.tsx) — the working
      // inbox (status 'unresolved', unchanged) and "Needs review" (status
      // 'held' — a sender the household hasn't confirmed yet).
      tabs: {
        working: "Inbox",
        needsReview: "Needs review",
      },
      needsReview: {
        cta: "Review this sender →",
        emptyTitle: "Nothing waiting on review",
        emptyDescription:
          "Mail from a sender we don't yet recognize for this household waits here until you confirm them.",
        dialogTitle: "Review this sender",
        dialogDescription:
          "This arrived from someone we don't yet recognize for this household. Trusting them lets this — and anything else already waiting from the same address — into your working inbox.",
        // Shown next to the Trust button, naming the actual address that
        // will be trusted — see NeedsReviewDialog.tsx's own comment on why
        // this is sender_email, not the (possibly display-name) sender.
        trustTargetNotice:
          "Trusting will let in future mail from %{email} too.",
        // Shown INSTEAD of the Trust button when inbox_items.sender_email is
        // null — an item ingested before that column existed — see
        // NeedsReviewDialog.tsx's own comment.
        senderUnknownNotice:
          "We don't have a return address on file for this item, so there's nothing to trust yet. You can still discard it.",
        trustSender: "Trust sender",
        trusting: "Trusting…",
        discard: "Discard",
        discarding: "Discarding…",
        trusted: "Trusted — this is now in your Inbox",
        trustedWithReleased:
          "Trusted — this and %{smart_count} other waiting item are now in your Inbox |||| Trusted — this and %{smart_count} other waiting items are now in your Inbox",
        trustError: "Couldn't trust that sender. Try again.",
        discarded: "Discarded — nothing was filed",
        discardError: "Couldn't discard that",
      },
      parse: {
        autoFill: "Auto-fill from resume",
        lowConfidence: "Please check",
      },
      // Story 10.1 (Task 4): the share-target resolve screen
      // (inbox/ShareTarget.tsx).
      share: {
        title: "File this share",
        sourceLabel: "Where this came from",
        loading: "Filing what you shared…",
        noPreview: "No text — see the attached file.",
        shadchanLabel: "Shadchan",
        shadchanHelper: "Optional — who suggested this match",
        singleLabel: "Which single is this for?",
        linkLabel: "Or link to an existing suggestion",
        skip: "Skip — drop it in my Inbox",
        save: "Save & review",
        saved: "Filed as a suggestion",
        linked: "Linked to the existing suggestion",
        skipped: "Shared to your inbox",
        saveError: "Couldn't file that share",
        pickSingleError: "Choose which single this is for",
        // Review fix (F5, MEDIUM, Story 10.1): shown when a shared file
        // couldn't be read back from the Cache API (missing entry, or no
        // Cache API support) — the share still lands, without the file,
        // rather than silently uploading a fabricated 0-byte attachment.
        fileReadError:
          "Couldn't load the shared file — you can still file this without it.",
      },
      // Story 10.1 (Task 3): the "link to an existing suggestion" search,
      // shared by ShareTarget.tsx and InboxResolveDialog.tsx
      // (inbox/LinkToShidduchSearch.tsx).
      linkSearch: {
        placeholder: "Or link to an existing suggestion…",
        label: "Search your suggestions",
        loading: "Searching…",
        empty: "No matching suggestions.",
        // Review fix (F3, HIGH, Story 10.1): distinct from `empty` — a
        // failed search must never render as "no results".
        searchError:
          "Couldn't search your suggestions — try a different search.",
        onBoard: "already on the board",
        link: "Link",
      },
    },
    // Story 8.3 (Task 6): the shadchan-side compose dialog
    // (connections/RedtComposeDialog.tsx) — sending a redt into a connected
    // family's pipeline from inside the platform.
    redt_compose: {
      title: "Send a redt",
      description:
        "Describe the suggestion — the family confirms it on their side before it enters their pipeline.",
      subject_label: "Subject (optional)",
      subject_placeholder: "e.g. A suggestion for Rivky",
      text_label: "The suggestion",
      text_placeholder: "Who you have in mind, and why it's a fit…",
      submit: "Send redt",
      success: "Redt sent",
      error: "Couldn't send that redt. Try again.",
    },
    // Story 8.5 — the real `connections` resource (list, Connection 360
    // regions/tabs, send-a-redt and end-connection actions).
    connections: {
      list: {
        eyebrow: "Shadchanus",
        subtitle: "Every family you're connected with, in one place.",
        searchPlaceholder: "Search by family name",
        emptyTitle: "No connections yet",
        emptyDescription:
          "Once a family connects with you, they'll appear here — send them an invite from Settings to get started.",
        noMatches: "No connections match this search.",
      },
      header: {
        connectedSince: "Connected since %{date}",
      },
      status: {
        accepted: "Accepted",
        ended: "Ended %{date}",
        ended_short: "Ended",
      },
      stats: {
        redtsSent: "Redts sent",
      },
      overview: {
        proposedBy: "Proposed by",
        proposedByHousehold: "The family",
        proposedByShadchan: "You",
        endedAt: "Ended",
      },
      sendRedt: {
        button: "Send a redt",
        disabledReason:
          "This connection has ended — a redt can no longer be sent through it.",
      },
      end: {
        button: "End connection",
        confirmTitle: "End this connection?",
        confirmDescription:
          "This is immediate and cannot be undone. Its history stays visible, but a redt can no longer be sent through it.",
        confirmButton: "End connection",
        error: "Couldn't end that connection. Try again.",
      },
    },
    // Story 14.1 — Legal surfaces (terms/privacy/sub-processors).
    legal: {
      terms: {
        title: "Terms of Service",
        last_updated: "Last updated: 2026-08-09 (v1)",
        acceptance: {
          title: "1. Acceptance of Terms",
          body: "By accessing or using MyShadchan, you agree to be bound by these Terms. If you do not agree, do not use the service.",
        },
        accounts: {
          title: "2. Accounts",
          body: "You must be 18 or older to create an account. You are responsible for keeping your credentials secure and for all activity under your account. Accounts are per family/household; you may invite additional members.",
        },
        data: {
          title: "3. Your Data",
          body: "You own the records you create. MyShadchan does not pool your data with other families, does not use it to train models, and does not sell it. You can export or delete your data at any time from Settings → Privacy.",
        },
        usage: {
          title: "4. Acceptable Use",
          body: "You may not use the service for unlawful purposes, to harass anyone, or to interfere with the service's operation. We may suspend or terminate access for violations.",
        },
        availability: {
          title: "5. Availability & Changes",
          body: 'The service is provided "as is" without warranties. We may modify or discontinue features with reasonable notice. These Terms may be updated; continued use constitutes acceptance.',
        },
        limitation: {
          title: "6. Limitation of Liability",
          body: "To the fullest extent permitted by law, MyShadchan and its operators are not liable for any indirect, incidental, or consequential damages arising from your use of the service.",
        },
        contact: {
          title: "7. Contact",
          body: "Questions about these Terms? Contact us through the in-app feedback channel or at legal@myshadchan.example.",
        },
        footer_note: "The code is public. The service is free, run at cost.",
      },
      privacy: {
        title: "Privacy Policy",
        last_updated: "Last updated: 2026-08-09 (v1)",
        controller: {
          title: "1. Data Controller",
          body: "MyShadchan (operated by the MyShadchan project) is the data controller for the personal data you provide when using the service. Contact: legal@myshadchan.example.",
        },
        data_collected: {
          title: "2. Data We Collect",
          body: "We collect only what you explicitly provide: account email, family member names, shidduch records, reference people, notes, tasks, and uploaded files. We do not collect analytics, tracking pixels, or third-party cookies.",
        },
        purpose: {
          title: "3. Purpose & Legal Basis",
          body: "Your data is processed solely to provide the shidduch management service (contract performance) and to meet legal obligations (e.g., age verification). No profiling, automated decision-making, or marketing use occurs.",
        },
        sharing: {
          title: "4. Sharing & Sub-processors",
          body: "Your data is never sold. It is shared only with the sub-processors listed on our Sub-processors page (infrastructure, email delivery, payments, AI inference) and only as needed to operate the service. Each has a data processing agreement in place.",
        },
        rights: {
          title: "5. Your Rights",
          body: "You may access, rectify, export, or delete your data at any time from Settings → Privacy. You may also object to processing or request restriction. We respond within 30 days.",
        },
        retention: {
          title: "6. Retention",
          body: "Data is retained while your account is active. On deletion, it is removed from primary storage within 30 days and from backups within 90 days.",
        },
        security: {
          title: "7. Security",
          body: "Data is encrypted in transit (TLS 1.2+) and at rest (AES-256). Access is limited to authorized personnel. We run regular vulnerability scans and maintain an incident response plan.",
        },
        contact: {
          title: "8. Contact",
          body: "Privacy questions or requests: legal@myshadchan.example. You also have the right to lodge a complaint with your supervisory authority.",
        },
        footer_note: "The code is public. The service is free, run at cost.",
      },
      subprocessors: {
        title: "Sub-processors",
        version: "v1 · 2026-08-09",
        note: "Derived from deployment — amend when infra changes.",
        intro:
          "The following sub-processors process personal data on our behalf to deliver the MyShadchan service. Each has a Data Processing Agreement (DPA) in place incorporating Standard Contractual Clauses where required.",
        purpose_label: "Purpose",
        location_label: "Data location",
        dpa_badge: "DPA in place",
        changes: {
          title: "Changes to this list",
          body: "We will notify you via in-app banner and email at least 30 days before adding a new sub-processor. You may object by contacting legal@myshadchan.example; if we cannot accommodate the objection, you may terminate your account and export your data.",
        },
        footer_note: "The code is public. The service is free, run at cost.",
      },
    },
    // Story 15.2: Analytics metrics and privacy control (PRD §18)
    analytics: {
      privacy: {
        title: "Analytics Collection",
        description:
          "We collect anonymous, first-party usage metrics to understand how families use MyShadchan. No personal data, names, contact details, or note contents are ever included. This helps us improve the service while respecting your privacy.",
        collection: "Collect anonymous usage metrics",
        collection_hint:
          "Counts things like suggestions filed, reference calls logged, and inbox captures. Never names, phones, or note content.",
        enabled: "Collection is on",
        disabled: "Collection is off",
        policy_link: "Privacy Policy",
      },
      metrics: {
        items_filed: "Suggestions Filed",
        duplicates_confirmed: "Duplicates Confirmed",
        reference_calls: "Reference Calls Logged",
        channel_captures: "Inbox Captures",
        avg_time_to_file: "Avg. Time to File",
        cross_account_leaks: "Cross-Account Leaks",
        should_be_zero: "Should always be 0",
        alert: "ALERT: Data leak detected",
        misrouted_items: "Mis-routed Items",
        duplicate_false_positive: "Duplicate False Positive Rate",
        dismissed_rate: "Dismissed ÷ Total flags",
        trial_to_paid: "Trial → Paid Conversion",
        ai_cost_per_family: "AI Cost per Active Family",
      },
    },
  },
} as const;

type MessageSchema<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends Record<string, unknown>
      ? MessageSchema<T[K]>
      : never;
};

export type CrmMessages = MessageSchema<typeof englishCrmMessages>;
