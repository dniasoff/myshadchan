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
        parents_en: "Parents",
        shul_en: "Shul",
        age: "Age",
        height: "Height",
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
        notes: "Notes",
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
      // used to live in ShidduchTimeline.tsx and ReferenceTimeline.tsx.
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
        noMatches: "No singles match this search.",
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
      // ("shidduchim"), never "suggestion(s)"; `ShadchanCard.tsx`'s existing
      // "suggestion"/"suggestions" text is Story 5.9's remediation, not
      // this one's.
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
      },
      tabs: {
        conversations: "Conversations",
        timeline: "Timeline and notes",
        reminders: "Reminders",
        assistant: "Assistant",
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
      repeat: {
        none: "No other conversations with this person yet.",
        title: "You have spoken to %{name} about %{smart_count} other singles",
        progress: "%{contacted} of %{total} of those conversations happened",
      },
      timeline: {
        notePlaceholder: "Add a note about this person",
        addNote: "Add note",
        empty: "Nothing has happened with this person yet.",
      },
      tasks: {
        placeholder: "Remind me to...",
        dueDate: "Due date",
        add: "Add reminder",
        empty: "No reminders on this person.",
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
        summaryTitle: "Across the references you have spoken to",
        covered: "Covered",
        nothingCovered: "Nothing recorded yet.",
        gaps: "Still missing",
        noGaps: "Every topic has been touched on.",
        contradiction: "References differ",
        contradictionDetail:
          "%{warm} spoke warmly and %{reserved} raised a reservation. Both are worth reading in full.",
        outstanding: "%{smart_count} conversations have not happened yet.",
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
    },
    validation: {
      invalid_url: "Must be a valid URL",
      invalid_linkedin_url: "URL must be from linkedin.com",
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
