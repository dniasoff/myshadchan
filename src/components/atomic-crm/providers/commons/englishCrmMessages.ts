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
      create: {
        error: "An error occurred while creating the user.",
        success:
          "User created. They will soon receive an email to set their password.",
        title: "Create a new user",
      },
      edit: {
        error: "An error occurred. Please try again.",
        record_not_found: "Record not found",
        success: "User updated successfully",
        title: "Edit %{name}",
      },
      action: {
        new: "New user",
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
    action: {
      reset_password: "Reset Password",
    },
    auth: {
      first_name: "First name",
      last_name: "Last name",
      confirm_password: "Confirm password",
      confirmation_required:
        "Please follow the link we just sent you by email to confirm your account.",
      recovery_email_sent:
        "If you're a registered user, you should receive a password recovery email shortly.",
      sign_in_failed: "Failed to log in.",
      sign_in_google_workspace: "Sign in with Google Workplace",
      google_oauth_not_configured:
        "Google sign-in is not configured. Ask an administrator to enable and configure the Google provider in Supabase.",
      show_password: "Show password",
      hide_password: "Hide password",
      footer_private: "Private to your family",
      back_to_home: "Back to home",
      login: {
        title: "Welcome back",
        subtitle: "Sign in to your records.",
      },
      signup: {
        create_account: "Create account",
        create_first_user:
          "Create the first user account to complete the setup.",
        creating: "Creating...",
        initial_user_created: "Initial user successfully created",
        title: "Create your family's record",
        subtitle: "Set up the first account for your household.",
      },
      welcome_title: "Welcome to MyShadchan",
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
      // persona_add_error is the generic add_persona() failure; the three
      // persona_remove_error_* keys map 1:1 to remove_persona()'s specific
      // guard messages (02_functions.sql) so Settings never shows raw
      // Postgres text.
      personas_title: "Personas",
      persona_add_error: "Couldn't set that up. Try again.",
      persona_remove_error_ask_admin:
        "This record is managed by your household admin — ask them to make this change.",
      persona_remove_error_only_persona:
        "You can't remove your only persona. Add another first.",
      persona_remove_error_parent_guard:
        "Another admin needs to manage your household's other singles before you can remove this.",
      persona_remove_error_generic: "Couldn't remove that. Try again.",
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
    profile: {
      password: {
        change: "Change password",
      },
      password_reset_sent:
        "A reset password email has been sent to your email address",
      record_not_found: "Record not found",
      title: "Profile",
      updated: "Your profile has been updated",
      update_error: "An error occurred. Please try again",
    },
    references: {
      list: {
        title: "Reference book",
        search: "Search name, phone, school...",
        linkedTo: "Linked to",
        linkedCount: "%{smart_count} singles",
        openReminders: "Reminders",
        hasOpenReminder: "Has an open reminder",
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
        kind: {
          note: "Note",
          call_logged: "Call logged",
          status_change: "Status changed",
          merge: "Merged",
          link_created: "Linked to a single",
          link_removed: "Unlinked from a single",
        },
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
