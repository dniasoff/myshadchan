export const englishCrmMessages = {
  resources: {
    shidduchim: {
      name: "Shidduch |||| Shidduchim",
      forcedCaseName: "Shidduch",
      fields: {
        name_en: "Name (EN)",
        name_he: "Name (HE)",
        child_id: "Child",
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
    children: {
      name: "Child |||| Children",
      forcedCaseName: "Child",
      fields: {
        first_name_en: "First name",
        last_name_en: "Last name",
        first_name_he: "First name (HE)",
        last_name_he: "Last name (HE)",
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
        name_he: "Name (HE)",
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
        name_he: "Name (HE)",
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
    companies: {
      name: "Company |||| Companies",
      forcedCaseName: "Company",
      fields: {
        name: "Company name",
        website: "Website",
        linkedin_url: "LinkedIn URL",
        phone_number: "Phone number",
        created_at: "Created at",
        nb_contacts: "Number of contacts",
        revenue: "Revenue",
        sector: "Sector",
        size: "Size",
        tax_identifier: "Tax Identifier",
        address: "Address",
        city: "City",
        zipcode: "Zip code",
        state_abbr: "State",
        country: "Country",
        description: "Description",
        context_links: "Context links",
        sales_id: "Account manager",
      },
      empty: {
        description: "It seems your company list is empty.",
        title: "No companies found",
      },
      field_categories: {
        contact: "Contact",
        additional_info: "Additional information",
        address: "Address",
        context: "Context",
      },
      action: {
        create: "Create Company",
        edit: "Edit company",
        new: "New Company",
        show: "Show company",
      },
      added_on: "Added on %{date}",
      followed_by: "Followed by %{name}",
      followed_by_you: "Followed by you",
      no_contacts: "No contact",
      nb_contacts: "%{smart_count} contact |||| %{smart_count} contacts",
      nb_deals: "%{smart_count} deal |||| %{smart_count} deals",
      sizes: {
        one_employee: "1 employee",
        two_to_nine_employees: "2-9 employees",
        ten_to_forty_nine_employees: "10-49 employees",
        fifty_to_two_hundred_forty_nine_employees: "50-249 employees",
        two_hundred_fifty_or_more_employees: "250 or more employees",
      },
      autocomplete: {
        create_error: "An error occurred while creating the company",
        create_item: "Create %{item}",
        create_label: "Start typing to create a new company",
      },
      filters: {
        only_mine: "Only companies I manage",
      },
    },
    contacts: {
      name: "Contact |||| Contacts",
      forcedCaseName: "Contact",
      field_categories: {
        background_info: "Background info",
        identity: "Identity",
        misc: "Misc",
        personal_info: "Personal info",
        position: "Position",
      },
      fields: {
        first_name: "First name",
        last_name: "Last name",
        last_seen: "Last seen",
        title: "Title",
        company_id: "Company",
        email_jsonb: "Email addresses",
        email: "Email",
        phone_jsonb: "Phone numbers",
        phone_number: "Phone number",
        linkedin_url: "LinkedIn URL",
        background: "Background info (bio, how you met, etc)",
        has_newsletter: "Has newsletter",
        sales_id: "Account manager",
      },
      action: {
        add: "Add contact",
        add_first: "Add your first contact",
        create: "Create contact",
        edit: "Edit contact",
        export_vcard: "Export to vCard",
        new: "New Contact",
        show: "Show contact",
      },
      background: {
        last_activity_on: "Last activity on %{date}",
        added_on: "Added on %{date}",
        followed_by: "Followed by %{name}",
        followed_by_you: "Followed by you",
        status_none: "None",
      },
      position_at: "%{title} at",
      position_at_company: "%{title} at %{company}",
      empty: {
        description: "It seems your contact list is empty.",
        title: "No contacts found",
      },
      import: {
        title: "Import contacts",
        button: "Import CSV",
        complete:
          "Contacts import complete. Imported %{importCount} contacts, with %{errorCount} errors",
        progress:
          "Imported %{importCount} / %{rowCount} contacts, with %{errorCount} errors.",
        error:
          "Failed to import this file, please make sure your provided a valid CSV file.",
        imported: "Imported",
        remaining_time: "Estimated remaining time:",
        running: "The import is running, please do not close this tab.",
        sample_download: "Download CSV sample",
        sample_hint: "Here is a sample CSV file you can use as a template",
        stop: "Stop import",
        csv_file: "CSV File",
        contacts_label: "contact |||| contacts",
      },
      inputs: {
        genders: {
          male: "He/Him",
          female: "She/Her",
          nonbinary: "They/Them",
        },
        personal_info_types: {
          work: "Work",
          home: "Home",
          other: "Other",
        },
      },
      list: {
        error_loading: "Error loading contacts",
      },
      bulk_tag: {
        action: "Tag",
        back: "Back to tags",
        create_description:
          "Create a new tag and apply it to the selected contacts.",
        description:
          "Choose an existing tag or create a new one for the selected contacts.",
        empty: "No tags yet. Create one to tag the selected contacts.",
        error: "Failed to add tag to contacts",
        noop: "Selected contacts already have this tag",
        success:
          "Tag added to %{smart_count} contact |||| Tag added to %{smart_count} contacts",
        title: "Add tag to contacts",
      },
      merge: {
        action: "Merge with another contact",
        confirm: "Merge Contacts",
        current_contact: "Current Contact (will be deleted)",
        description: "Merge this contact with another one.",
        error: "Failed to merge contacts",
        merging: "Merging...",
        no_additional_data: "No additional data to merge",
        select_target: "Please select a contact to merge with",
        success: "Contacts merged successfully",
        target_contact: "Target Contact (will be kept)",
        title: "Merge Contact",
        warning_description:
          "All data will be transferred to the second contact. This action cannot be undone.",
        warning_title: "Warning: Destructive Operation",
        what_will_be_merged: "What will be merged:",
      },
      filters: {
        before_last_month: "Before last month",
        before_this_month: "Before this month",
        before_this_week: "Before this week",
        managed_by_me: "Managed by me",
        search: "Search name, company...",
        this_week: "This week",
        today: "Today",
        tags: "Tags",
        tasks: "Tasks",
      },
      hot: {
        empty_change_status:
          'Change the status of a contact by adding a note to that contact and clicking on "show options".',
        empty_hint: 'Contacts with a "hot" status will appear here.',
        title: "Hot Contacts",
      },
    },
    deals: {
      name: "Deal |||| Deals",
      fields: {
        name: "Name",
        description: "Description",
        company_id: "Company",
        contact_ids: "Contacts",
        category: "Category",
        amount: "Budget",
        expected_closing_date: "Expected closing date",
        stage: "Stage",
      },
      action: {
        back_to_deal: "Back to deal",
        create: "Create deal",
        new: "New Deal",
      },
      field_categories: {
        misc: "Misc",
      },
      archived: {
        action: "Archive",
        error: "Error: deal not archived",
        list_title: "Archived Deals",
        success: "Deal archived",
        title: "Archived Deal",
        view: "View archived deals",
      },
      inputs: {
        linked_to: "Linked to",
      },
      unarchived: {
        action: "Send back to the board",
        error: "Error: deal not unarchived",
        success: "Deal unarchived",
      },
      updated: "Deal updated",
      empty: {
        before_create: "before creating a deal.",
        description: "It seems your deal list is empty.",
        title: "No deals found",
      },
      invalid_date: "Invalid date",
    },
    notes: {
      name: "Note |||| Notes",
      forcedCaseName: "Note",
      fields: {
        status: "Status",
        date: "Date",
        attachments: "Attachments",
        contact_id: "Contact",
        deal_id: "Deal",
      },
      action: {
        add: "Add note",
        add_first: "Add your first note",
        delete: "Delete note",
        edit: "Edit note",
        update: "Update note",
        add_this: "Add this note",
      },
      sheet: {
        create: "Create note",
        create_for: "Create note for %{name}",
        edit: "Edit note",
        edit_for: "Edit note for %{name}",
      },
      deleted: "Note deleted",
      empty: "No notes yet",
      author_added: "%{name} added a note",
      you_added: "You added a note",
      me: "Me",
      list: {
        error_loading: "Error loading notes",
      },
      note_for_contact: "Note for %{name}",
      stepper: {
        hint: "Go to a contact page and add a note",
      },
      added: "Note added",
      inputs: {
        add_note: "Add a note",
        options_hint: "(attach files, or change details)",
        show_options: "Show options",
      },
      actions: {
        attach_document: "Attach document",
      },
      validation: {
        note_or_attachment_required: "A note or an attachment is required",
      },
    },
    sales: {
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
        contact_id: "Contact",
        due_short: "due",
      },
      action: {
        add: "Add task",
        create: "Create task",
        edit: "Edit task",
      },
      actions: {
        postpone_next_week: "Postpone to next week",
        postpone_tomorrow: "Postpone to tomorrow",
        title: "task actions",
      },
      added: "Task added",
      deleted: "Task deleted successfully",
      dialog: {
        create: "Create task",
        create_for: "Create task for %{name}",
      },
      sheet: {
        edit: "Edit task",
        edit_for: "Edit task for %{name}",
      },
      empty: "No tasks yet",
      empty_list_hint: "Tasks added to your contacts will appear here.",
      filters: {
        later: "Later",
        overdue: "Overdue",
        this_week: "This week",
        today: "Today",
        tomorrow: "Tomorrow",
        with_pending: "With pending tasks",
      },
      regarding_contact: "(Re: %{name})",
      updated: "Task updated",
    },
    tags: {
      name: "Tag |||| Tags",
      action: {
        add: "Add tag",
        create: "Create new tag",
      },
      dialog: {
        color: "Color",
        create_title: "Create a new tag",
        edit_title: "Edit tag",
        name_label: "Tag name",
        name_placeholder: "Enter tag name",
      },
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
    },
    landing: {
      nav: {
        sign_in: "Sign in",
      },
      hero: {
        eyebrow: "Shidduchim record",
        title_lead: "A record of the shidduch process",
        title_accent: "for your children.",
        title_he: "רישום של תהליך השידוכים",
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
          body: "Resumes arrive by message, email, photo, or on paper and scanned in. Each is stored and filed against the child it was suggested for.",
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
          body: "A resume is entered against a child. If that name has been suggested before, the earlier suggestion is shown at that point.",
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
          body: "Records are held per family. They are not pooled with other families, and they are not used to suggest anything to anyone else.",
        },
        directory: {
          title: "No directory",
          body: "There is no public directory. No one can look a family up.",
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
      activity: "Activity",
      added: "added",
      details: "Details",
      last_activity_with_date: "last activity %{date}",
      load_more: "Load more",
      misc: "Misc",
      past: "Past",
      read_more: "Read more",
      retry: "Retry",
      show_less: "Show less",
      copied: "Copied!",
      copy: "Copy",
      loading: "Loading...",
      me: "Me",
      task_count: "%{smart_count} task |||| %{smart_count} tasks",
    },
    changelog: {
      title: "Changelog",
    },
    activity: {
      added_company: "%{name} added company",
      you_added_company: "You added company",
      added_contact: "%{name} added",
      you_added_contact: "You added",
      added_note: "%{name} added a note about",
      you_added_note: "You added a note about",
      added_note_about_deal: "%{name} added a note about deal",
      you_added_note_about_deal: "You added a note about deal",
      added_deal: "%{name} added deal",
      you_added_deal: "You added deal",
      at_company: "at",
      to: "to",
      load_more: "Load more activity",
    },
    dashboard: {
      deals_chart: "Upcoming Deal Revenue",
      deals_pipeline: "Deals Pipeline",
      latest_activity: "Latest Activity",
      latest_activity_error: "Error loading latest activity",
      latest_notes: "My Latest Notes",
      latest_notes_added_ago: "added %{timeAgo}",
      stepper: {
        install: "Install MyShadchan",
        progress: "%{step}/3 done",
        whats_next: "What's next?",
      },
      upcoming_tasks: "Upcoming Tasks",
    },
    header: {
      import_data: "Import data",
    },
    image_editor: {
      change: "Change",
      drop_hint: "Drop a file to upload, or click to select it.",
      editable_content: "Editable content",
      title: "Upload and resize image",
      update_image: "Update Image",
    },
    import: {
      action: {
        download_error_report: "Download the error report",
        import: "Import",
        import_another: "Import another file",
      },
      error: {
        unable: "Unable to import this file.",
      },
      idle: {
        description_1:
          "You can import sales, companies, contacts, companies, notes, and tasks.",
        description_2:
          "Data must be in a JSON file matching the following sample:",
      },
      status: {
        all_success: "All records were imported successfully.",
        complete: "Import complete.",
        failed: "Failed",
        imported: "Imported",
        in_progress:
          "Import in progress, please don't navigate away from this page.",
        some_failed: "Some records were not imported.",
        table_caption: "Import status",
      },
      title: "Import Data",
    },
    settings: {
      about: "About",
      companies: {
        sectors: "Sectors",
      },
      dark_mode_logo: "Dark Mode Logo",
      deals: {
        categories: "Categories",
        currency: "Currency",
        pipeline_help:
          "Select which deal stages should count as pipeline deals.",
        pipeline_statuses: "Pipeline Statuses",
        stages: "Stages",
      },
      light_mode_logo: "Light Mode Logo",
      notes: {
        statuses: "Statuses",
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
        in_use:
          "Cannot remove %{display_name} that are still used by deals: %{items}",
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
      inbound: {
        description:
          "You can start sending emails to your server's inbound email address, e.g. by adding it to the %{field} field. MyShadchan will process the emails and add notes to the corresponding contacts.",
        title: "Inbound email",
      },
      mcp: {
        title: "MCP Server",
        description:
          "Use this URL to connect your AI assistant to your CRM data via the Model Context Protocol (MCP).",
      },
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
