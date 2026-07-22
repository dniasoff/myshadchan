import type { CrmMessages } from "./englishCrmMessages";

export const frenchCrmMessages = {
  resources: {
    shidduchim: {
      name: "Shidduch |||| Shidduchim",
      forcedCaseName: "Shidduch",
      fields: {
        name_en: "Nom (EN)",
        name_he: "Nom (HE)",
        child_id: "Enfant",
        shadchan_id: "Shadchan",
        seminary_en: "Yeshiva / séminaire",
        location_en: "Lieu",
        parents_en: "Parents",
        shul_en: "Shul",
        age: "Âge",
        height: "Taille",
        redt_date: "Date de proposition",
        pipeline_state: "État",
      },
    },
    children: {
      name: "Enfant |||| Enfants",
      forcedCaseName: "Enfant",
      fields: {
        first_name_en: "Prénom",
        last_name_en: "Nom",
        first_name_he: "Prénom (HE)",
        last_name_he: "Nom (HE)",
        community: "Communauté",
        status: "Statut",
        gender: "Genre",
      },
    },
    shadchanim: {
      name: "Shadchan |||| Shadchanim",
      forcedCaseName: "Shadchan",
      fields: {
        name: "Nom",
        name_he: "Nom (HE)",
        location: "Lieu",
        responsiveness: "Réactivité",
        notes: "Notes",
      },
    },
    references: {
      name: "Référence |||| Références",
      forcedCaseName: "Référence",
      fields: {
        name_en: "Nom",
        name_he: "Nom (HE)",
        relationship: "Relation",
        phone: "Téléphone",
        school: "École",
        grad_year: "Année de fin d'études",
        linked_shidduchim_count: "Célibataires liés",
        contacted_count: "Contactées",
        last_conversation_at: "Dernière conversation",
        open_task_count: "Rappels ouverts",
      },
    },
    companies: {
      name: "Entreprise |||| Entreprises",
      forcedCaseName: "Entreprise",
      fields: {
        name: "Nom de l'entreprise",
        website: "Site web",
        linkedin_url: "LinkedIn",
        phone_number: "Numéro de téléphone",
        created_at: "Date de création",
        nb_contacts: "Nombre de contacts",
        revenue: "Chiffre d'affaires",
        sector: "Secteur",
        size: "Taille",
        tax_identifier: "Identifiant fiscal",
        address: "Adresse",
        city: "Ville",
        zipcode: "Code postal",
        state_abbr: "État",
        country: "Pays",
        description: "Description",
        context_links: "URLs de contexte",
        sales_id: "Responsable de compte",
      },
      empty: {
        description: "Il semble que la liste de vos entreprises soit vide.",
        title: "Aucune entreprise trouvée",
      },
      field_categories: {
        contact: "Contact",
        additional_info: "Informations supplémentaires",
        address: "Adresse",
        context: "Contexte",
      },
      action: {
        create: "Créer une entreprise",
        edit: "Modifier l'entreprise",
        new: "Nouvelle entreprise",
        show: "Afficher l'entreprise",
      },
      added_on: "Ajoutée le %{date}",
      followed_by: "Suivie par %{name}",
      followed_by_you: "Suivie par vous",
      no_contacts: "Aucun contact",
      nb_contacts: "%{smart_count} contact |||| %{smart_count} contacts",
      nb_deals: "%{smart_count} affaire |||| %{smart_count} affaires",
      sizes: {
        one_employee: "1 employé",
        two_to_nine_employees: "2-9 employés",
        ten_to_forty_nine_employees: "10-49 employés",
        fifty_to_two_hundred_forty_nine_employees: "50-249 employés",
        two_hundred_fifty_or_more_employees: "250 employés ou plus",
      },
      autocomplete: {
        create_error:
          "Une erreur s'est produite lors de la création de l'entreprise",
        create_item: "Créer %{item}",
        create_label: "Commencez à taper pour créer une nouvelle entreprise",
      },
      filters: {
        only_mine: "Seulement les entreprises que je gère",
      },
    },
    contacts: {
      name: "Contact |||| Contacts",
      forcedCaseName: "Contact",
      field_categories: {
        background_info: "Informations complémentaires",
        identity: "Identité",
        misc: "Divers",
        personal_info: "Informations personnelles",
        position: "Poste",
      },
      fields: {
        first_name: "Prénom",
        last_name: "Nom",
        last_seen: "Dernière activité",
        title: "Titre",
        company_id: "Entreprise",
        email_jsonb: "Adresses e-mail",
        email: "E-mail",
        phone_jsonb: "Numéros de téléphone",
        phone_number: "Numéro de téléphone",
        linkedin_url: "URL LinkedIn",
        background: "Informations de contexte",
        has_newsletter: "Abonné à la newsletter",
        sales_id: "Responsable de compte",
      },
      action: {
        add: "Ajouter un contact",
        add_first: "Ajoutez votre premier contact",
        create: "Créer un contact",
        edit: "Modifier le contact",
        export_vcard: "Exporter en vCard",
        new: "Nouveau contact",
        show: "Afficher le contact",
      },
      background: {
        last_activity_on: "Dernière activité le %{date}",
        added_on: "Ajouté le %{date}",
        followed_by: "Suivi par %{name}",
        followed_by_you: "Suivi par vous",
        status_none: "Aucun",
      },
      position_at: "%{title} chez",
      position_at_company: "%{title} chez %{company}",
      empty: {
        description: "Il semble que votre liste de contacts soit vide.",
        title: "Aucun contact trouvé",
      },
      import: {
        title: "Importer des contacts",
        button: "Importer un fichier CSV",
        complete:
          "Import des contacts terminé. %{importCount} contacts importés, %{errorCount} erreurs",
        progress:
          "%{importCount} / %{rowCount} contacts importés, avec %{errorCount} erreurs.",
        error:
          "Échec de l'importation de ce fichier. Veuillez vous assurer que vous avez fourni un fichier CSV valide.",
        imported: "Importé",
        remaining_time: "Temps restant estimé :",
        running: "L'import est en cours, merci de ne pas fermer cet onglet.",
        sample_download: "Télécharger un exemple CSV",
        sample_hint:
          "Voici un exemple de fichier CSV que vous pouvez utiliser comme modèle",
        stop: "Arrêter l'importation",
        csv_file: "Fichier CSV",
        contacts_label: "contact |||| contacts",
      },
      inputs: {
        genders: {
          male: "Monsieur",
          female: "Madame",
          nonbinary: "Indéterminé",
        },
        personal_info_types: {
          work: "Pro",
          home: "Perso",
          other: "Autre",
        },
      },
      list: {
        error_loading: "Erreur lors du chargement des contacts",
      },
      bulk_tag: {
        action: "Étiqueter",
        back: "Retour aux étiquettes",
        create_description:
          "Créez une nouvelle étiquette et appliquez-la aux contacts sélectionnés.",
        description:
          "Choisissez une étiquette existante ou créez-en une pour les contacts sélectionnés.",
        empty:
          "Aucune étiquette pour le moment. Créez-en une pour étiqueter les contacts sélectionnés.",
        error: "Impossible d'ajouter l'étiquette aux contacts",
        noop: "Les contacts sélectionnés ont déjà cette étiquette",
        success:
          "Étiquette ajoutée à %{smart_count} contact |||| Étiquette ajoutée à %{smart_count} contacts",
        title: "Ajouter une étiquette aux contacts",
      },
      merge: {
        action: "Fusionner avec un autre contact",
        confirm: "Fusionner les contacts",
        current_contact: "Contact actuel (sera supprimé)",
        description: "Fusionnez ce contact avec un autre.",
        error: "Échec de la fusion des contacts",
        merging: "Fusion...",
        no_additional_data: "Aucune donnée supplémentaire à fusionner",
        select_target: "Veuillez sélectionner un contact avec lequel fusionner",
        success: "Contacts fusionnés avec succès",
        target_contact: "Contact cible (sera conservé)",
        title: "Fusionner les contacts",
        warning_description:
          "Toutes les données seront transférées au deuxième contact. Cette action ne peut pas être annulée.",
        warning_title: "Avertissement : opération destructrice",
        what_will_be_merged: "Ce qui sera fusionné :",
      },
      filters: {
        before_last_month: "Avant le mois dernier",
        before_this_month: "Avant ce mois-ci",
        before_this_week: "Avant cette semaine",
        managed_by_me: "Géré par moi",
        search: "Rechercher nom, entreprise...",
        this_week: "Cette semaine",
        today: "Aujourd'hui",
        tags: "Étiquettes",
        tasks: "Tâches",
      },
      hot: {
        empty_change_status:
          'Changez le statut d\'un contact en ajoutant une note à ce contact et en cliquant sur "afficher les options".',
        empty_hint: 'Les contacts avec un statut "chaud" apparaîtront ici.',
        title: "Contacts chauds",
      },
    },
    deals: {
      name: "Affaire |||| Affaires",
      fields: {
        name: "Nom",
        description: "Description",
        company_id: "Entreprise",
        contact_ids: "Contacts",
        category: "Catégorie",
        amount: "Budget",
        expected_closing_date: "Date de clôture prévue",
        stage: "Étape",
      },
      action: {
        back_to_deal: "Retour à l'affaire",
        create: "Créer une affaire",
        new: "Nouvelle affaire",
      },
      field_categories: {
        misc: "Divers",
      },
      archived: {
        action: "Archiver",
        error: "Erreur : affaire non archivée",
        list_title: "Affaires archivées",
        success: "Affaire archivée",
        title: "Affaire archivée",
        view: "Afficher les affaires archivées",
      },
      inputs: {
        linked_to: "Lié à",
      },
      unarchived: {
        action: "Renvoyer au tableau",
        error: "Erreur : affaire non désarchivée",
        success: "Affaire désarchivée",
      },
      updated: "Affaire mise à jour",
      empty: {
        before_create: "avant de créer une affaire.",
        description: "Il semble que votre liste d'affaires soit vide.",
        title: "Aucune affaire trouvée",
      },
      invalid_date: "Date invalide",
    },
    notes: {
      name: "Note |||| Notes",
      forcedCaseName: "Note",
      fields: {
        status: "Statut",
        date: "Date",
        attachments: "Pièces jointes",
        contact_id: "Contact",
        deal_id: "Affaire",
      },
      action: {
        add: "Ajouter une note",
        add_first: "Ajoutez votre première note",
        delete: "Supprimer la note",
        edit: "Modifier la note",
        update: "Mettre à jour la note",
        add_this: "Ajouter cette note",
      },
      sheet: {
        create: "Créer une note",
        create_for: "Créer une note pour %{name}",
        edit: "Modifier la note",
        edit_for: "Modifier la note pour %{name}",
      },
      deleted: "Note supprimée",
      empty: "Aucune note pour l'instant",
      author_added: "%{name} a ajouté une note",
      you_added: "Vous avez ajouté une note",
      me: "Moi",
      list: {
        error_loading: "Erreur lors du chargement des notes",
      },
      note_for_contact: "Note pour %{name}",
      stepper: {
        hint: "Accédez à une page de contact et ajoutez une note",
      },
      added: "Note ajoutée",
      inputs: {
        add_note: "Ajouter une note",
        options_hint: "(joindre des fichiers ou modifier les détails)",
        show_options: "Afficher les options",
      },
      actions: {
        attach_document: "Joindre un document",
      },
      validation: {
        note_or_attachment_required: "Une note ou une pièce jointe est requise",
      },
    },
    sales: {
      name: "Utilisateur |||| Utilisateurs",
      fields: {
        first_name: "Prénom",
        last_name: "Nom",
        email: "E-mail",
        administrator: "Admin",
        disabled: "Désactivé",
      },
      create: {
        error:
          "Une erreur s'est produite lors de la création de l'utilisateur.",
        success:
          "Utilisateur créé. Ils recevront prochainement un email pour définir leur mot de passe.",
        title: "Créer un nouvel utilisateur",
      },
      edit: {
        error: "Une erreur s'est produite. Veuillez réessayer.",
        record_not_found: "Enregistrement introuvable",
        success: "Utilisateur mis à jour avec succès",
        title: "Modifier %{name}",
      },
      action: {
        new: "Nouvel utilisateur",
      },
    },
    tasks: {
      name: "Tâche |||| Tâches",
      forcedCaseName: "Tâche",
      fields: {
        text: "Description",
        due_date: "Date d'échéance",
        type: "Type",
        contact_id: "Contact",
        due_short: "échéance",
      },
      action: {
        add: "Ajouter une tâche",
        create: "Créer une tâche",
        edit: "Modifier la tâche",
      },
      actions: {
        postpone_next_week: "Reporté à la semaine prochaine",
        postpone_tomorrow: "Reporter à demain",
        title: "Actions de tâche",
      },
      added: "Tâche ajoutée",
      deleted: "Tâche supprimée avec succès",
      dialog: {
        create: "Créer une tâche",
        create_for: "Créer une tâche pour %{name}",
      },
      sheet: {
        edit: "Modifier la tâche",
        edit_for: "Modifier la tâche pour %{name}",
      },
      empty: "Aucune tâche pour l'instant",
      empty_list_hint: "Les tâches ajoutées à vos contacts apparaîtront ici.",
      filters: {
        later: "Plus tard",
        overdue: "En retard",
        this_week: "Cette semaine",
        today: "Aujourd'hui",
        tomorrow: "Demain",
        with_pending: "Avec des tâches en attente",
      },
      regarding_contact: "(Concernant : %{name})",
      updated: "Tâche mise à jour",
    },
    tags: {
      name: "Étiquette |||| Étiquettes",
      action: {
        add: "Ajouter une étiquette",
        create: "Créer une nouvelle étiquette",
      },
      dialog: {
        color: "Couleur",
        create_title: "Créer une nouvelle étiquette",
        edit_title: "Modifier l'étiquette",
        name_label: "Nom de l'étiquette",
        name_placeholder: "Saisir le nom de l'étiquette",
      },
    },
  },
  crm: {
    action: {
      reset_password: "Réinitialiser le mot de passe",
    },
    auth: {
      first_name: "Prénom",
      last_name: "Nom",
      confirm_password: "Confirmer le mot de passe",
      confirmation_required:
        "Veuillez suivre le lien que nous venons de vous envoyer par email pour confirmer votre compte.",
      recovery_email_sent:
        "Si vous êtes un utilisateur enregistré, vous devriez recevoir prochainement un e-mail de récupération de mot de passe.",
      sign_in_failed: "Échec de la connexion.",
      sign_in_google_workspace: "Connectez-vous avec Google Workplace",
      google_oauth_not_configured:
        "La connexion avec Google n'est pas configurée. Demandez à un administrateur d'activer et de configurer le fournisseur Google dans Supabase.",
      signup: {
        create_account: "Créer un compte",
        create_first_user:
          "Créez le premier compte utilisateur pour terminer la configuration.",
        creating: "Création...",
        initial_user_created: "Utilisateur initial créé avec succès",
      },
      welcome_title: "Bienvenue sur MyShadchan",
    },
    landing: {
      nav: {
        sign_in: "Se connecter",
      },
      hero: {
        eyebrow: "Registre des shidduchim",
        title_lead: "Un registre du processus de shidduch",
        title_accent: "pour vos enfants.",
        title_he: "רישום של תהליך השידוכים",
        lead: "Propositions, shadchanim, appels de références et rencontres, réunis au même endroit.",
        cta: "Se connecter",
        cta_secondary: "Ce que fait le logiciel",
        note: "Les données sont conservées par famille. Elles ne sont pas partagées avec d'autres familles.",
      },
      what: {
        eyebrow: "Ce que fait le logiciel",
        title_lead: "Le logiciel enregistre",
        title_accent: "les CV, les appels, les rencontres et les décisions.",
        resumes: {
          title: "CV",
          body: "Les CV arrivent par message, par e-mail, en photo, ou sur papier et sont numérisés. Chacun est enregistré et classé auprès de l'enfant pour lequel il a été proposé.",
        },
        repeats: {
          title: "Propositions répétées",
          body: "Quand un nom déjà proposé est saisi, la proposition antérieure et la décision prise sont affichées.",
        },
        references: {
          title: "Appels de références",
          body: "Chaque appel de références indique à qui l'on a parlé, ce qui a été dit, et quelles questions n'ont pas été posées.",
        },
        status: {
          title: "Statut",
          body: "Chaque proposition se trouve dans l'un des sept états, du premier jusqu'à une décision.",
        },
        states_caption: "Les sept états",
      },
      how: {
        eyebrow: "Comment cela fonctionne",
        title_lead: "Trois étapes,",
        title_accent: "du CV à la décision.",
        enter: {
          title: "Saisir le CV",
          body: "Un CV est saisi pour un enfant. Si ce nom a déjà été proposé, la proposition antérieure est affichée à ce moment-là.",
        },
        record: {
          title: "Consigner ce qui se passe",
          body: "Les appels de références, les notes et les rencontres sont ajoutés à la proposition au fur et à mesure.",
        },
        state: {
          title: "Définir l'état",
          body: "La proposition passe d'un état à l'autre parmi les sept, jusqu'à ce qu'une décision soit enregistrée.",
        },
      },
      privacy: {
        eyebrow: "Vos données",
        title_lead: "Les données sont conservées",
        title_accent: "par famille.",
        pooled: {
          title: "Aucune mise en commun",
          body: "Les données sont conservées par famille. Elles ne sont pas mises en commun avec d'autres familles et ne servent à proposer quoi que ce soit à quelqu'un d'autre.",
        },
        directory: {
          title: "Aucun annuaire",
          body: "Il n'existe aucun annuaire public. Personne ne peut rechercher une famille.",
        },
        export: {
          title: "Export et suppression",
          body: "Toutes les données peuvent être exportées ou supprimées à tout moment.",
        },
      },
      openness: {
        eyebrow: "Code et coût",
        title_lead: "Le code est public.",
        title_accent: "Le service est gratuit.",
        code: {
          title: "Code",
          body: "Le code est public. Il peut être lu, audité et auto-hébergé, et devient entièrement open source deux ans après chaque version.",
        },
        cost: {
          title: "Coût",
          body: "Le service est gratuit. Il est assuré à prix coûtant, sans but lucratif.",
        },
      },
      closing: {
        title_lead: "Se connecter",
        title_accent: "au registre.",
        lead: "Les comptes sont créés avec une adresse e-mail.",
        cta: "Se connecter",
      },
      footer: {
        note: "Le code est public. Le service est gratuit, assuré à prix coûtant.",
      },
    },
    common: {
      activity: "Activité",
      added: "ajoutée",
      details: "Détails",
      last_activity_with_date: "dernière activité %{date}",
      load_more: "Charger plus",
      misc: "Divers",
      past: "Passé",
      read_more: "En savoir plus",
      retry: "Réessayer",
      show_less: "Afficher moins",
      task_count: "%{smart_count} tâche |||| %{smart_count} tâches",
      copied: "Copié !",
      copy: "Copier",
      loading: "Chargement...",
      me: "Moi",
    },
    changelog: {
      title: "Notes de version",
    },
    activity: {
      added_company: "%{name} a ajouté l'entreprise",
      you_added_company: "Vous avez ajouté l'entreprise",
      added_contact: "%{name} a ajouté le contact",
      you_added_contact: "Vous avez ajouté le contact",
      added_note: "%{name} a ajouté une note sur",
      you_added_note: "Vous avez ajouté une note sur",
      added_note_about_deal: "%{name} a ajouté une note sur l'affaire",
      you_added_note_about_deal: "Vous avez ajouté une note sur l'affaire",
      added_deal: "%{name} a ajouté l'affaire",
      you_added_deal: "Vous avez ajouté l'affaire",
      at_company: "chez",
      to: "à",
      load_more: "Charger plus d'activité",
    },
    dashboard: {
      deals_chart: "Revenus des affaires à venir",
      deals_pipeline: "Pipeline des affaires",
      latest_activity: "Dernière activité",
      latest_activity_error:
        "Erreur lors du chargement de la dernière activité",
      latest_notes: "Mes dernières notes",
      latest_notes_added_ago: "ajouté %{timeAgo}",
      stepper: {
        install: "Installer MyShadchan",
        progress: "%{step}/3 terminé",
        whats_next: "Et ensuite ?",
      },
      upcoming_tasks: "Tâches à venir",
    },
    header: {
      import_data: "Importer des données",
    },
    image_editor: {
      change: "Changer",
      drop_hint:
        "Déposez un fichier à télécharger ou cliquez pour le sélectionner.",
      editable_content: "Contenu modifiable",
      title: "Télécharger et redimensionner l'image",
      update_image: "Mettre à jour l'image",
    },
    import: {
      action: {
        download_error_report: "Téléchargez le rapport d'erreur",
        import: "Importer",
        import_another: "Importer un autre fichier",
      },
      error: {
        unable: "Impossible d'importer ce fichier.",
      },
      idle: {
        description_1:
          "Vous pouvez importer des ventes, des entreprises, des contacts, des entreprises, des notes et des tâches.",
        description_2:
          "Les données doivent se trouver dans un fichier JSON correspondant à l'exemple suivant :",
      },
      status: {
        all_success: "Tous les enregistrements ont été importés avec succès.",
        complete: "Importation terminée.",
        failed: "Échoué",
        imported: "Importé",
        in_progress: "Import en cours, veuillez ne pas quitter cette page.",
        some_failed: "Certains enregistrements n'ont pas été importés.",
        table_caption: "Statut d'importation",
      },
      title: "Importer des données",
    },
    settings: {
      about: "À propos",
      companies: {
        sectors: "Secteurs",
      },
      dark_mode_logo: "Logo du mode sombre",
      deals: {
        categories: "Catégories",
        currency: "Devise",
        pipeline_help:
          "Sélectionnez les étapes d'affaire à considérer comme des affaires dans le pipeline.",
        pipeline_statuses: "Statuts des pipelines",
        stages: "Étapes",
      },
      light_mode_logo: "Logo du mode clair",
      notes: {
        statuses: "Statuts",
      },
      reset_defaults: "Réinitialiser aux valeurs par défaut",
      save_error: "Échec de l'enregistrement de la configuration",
      saved: "Configuration enregistrée avec succès",
      saving: "Enregistrement...",
      tasks: {
        types: "Types",
      },
      preferences: "Préférences",
      title: "Paramètres",
      app_title: "Titre de l'application",
      sections: {
        branding: "Image de marque",
      },
      validation: {
        duplicate: "%{display_name} en double : %{items}",
        in_use:
          "Impossible de supprimer %{display_name} encore utilisés par des affaires : %{items}",
        validating: "Validation\u2026",
        entities: {
          categories: "catégories",
          stages: "étapes",
        },
      },
    },
    theme: {
      dark: "Sombre",
      label: "Thème",
      light: "Clair",
      system: "Système",
    },
    language: "Langue",
    navigation: {
      label: "Navigation CRM",
    },
    profile: {
      inbound: {
        description:
          "Vous pouvez commencer à envoyer des e-mails vers l'adresse de réception de votre serveur, par exemple en l'ajoutant au champ %{field}. MyShadchan traitera les e-mails et ajoutera des notes aux contacts correspondants.",
        title: "E-mail entrant",
      },
      mcp: {
        title: "Serveur MCP",
        description:
          "Utilisez cette URL pour connecter votre assistant IA aux données de votre CRM via le Model Context Protocol (MCP).",
      },
      password: {
        change: "Changer le mot de passe",
      },
      password_reset_sent:
        "Un e-mail de réinitialisation du mot de passe a été envoyé à votre adresse e-mail",
      record_not_found: "Enregistrement introuvable",
      title: "Profil",
      updated: "Votre profil a été mis à jour",
      update_error: "Une erreur s'est produite. Veuillez réessayer",
    },
    references: {
      list: {
        title: "Carnet de références",
        search: "Rechercher un nom, un téléphone, une école...",
        linkedTo: "Liée à",
        linkedCount: "%{smart_count} célibataires",
        openReminders: "Rappels",
        hasOpenReminder: "A un rappel en attente",
      },
      header: {
        progress: "%{contacted} conversations sur %{total} effectuées",
        relationshipNote:
          "Affichée par célibataire ci-dessous lorsqu'elle diffère.",
      },
      shidduch: {
        empty: "Personne n'a encore été interrogé au sujet de ce célibataire.",
        add: "Ajouter une référence",
      },
      tabs: {
        conversations: "Conversations",
        timeline: "Historique et notes",
        reminders: "Rappels",
        assistant: "Assistant",
      },
      match: {
        title: "Vous avez peut-être déjà parlé à cette personne",
        subtitle:
          "La liaison regroupe au même endroit tout ce que vous savez déjà sur elle.",
        confirm: "Oui, c'est %{name}",
        dismiss: "Non, une autre personne",
        why: "Pourquoi nous pensons cela",
        alreadyLinked: "Déjà liée à %{smart_count} autres célibataires",
        linked: "Liée à la personne que vous connaissez déjà.",
        confidence: {
          strong: "Correspondance forte",
          likely: "Correspondance probable",
          possible: "Correspondance possible",
        },
      },
      callStatus: {
        not_started: "Pas encore appelé",
        answered: "A répondu",
        no_answer: "Pas de réponse",
        call_back: "À rappeler",
        they_will_call_back: "Va rappeler",
      },
      call: {
        about: "À propos de %{name}",
        howDidItGo: "Comment s'est passé l'appel ?",
        whatTheySaid: "Ce qu'elle a dit",
        placeholder: "Écrivez autant ou aussi peu que vous voulez.",
        save: "Enregistrer et ajouter au journal",
        saved: "Ajouté au journal des appels.",
        onACall: "En appel",
      },
      callLog: {
        unlinked: "Non liée à un célibataire",
        nothingYet: "Rien n'a encore été noté pour cette conversation.",
        entries: "%{smart_count} entrées de journal",
        viaAssistant: "via le script d'appel",
        capture: "Enregistrer un appel",
        empty: "Cette personne n'est encore liée à aucun célibataire.",
      },
      repeat: {
        none: "Aucune autre conversation avec cette personne pour le moment.",
        title:
          "Vous avez parlé à %{name} au sujet de %{smart_count} autres célibataires",
        progress: "%{contacted} de ces %{total} conversations ont eu lieu",
      },
      timeline: {
        notePlaceholder: "Ajouter une note sur cette personne",
        addNote: "Ajouter une note",
        empty: "Rien ne s'est encore passé avec cette personne.",
        kind: {
          note: "Note",
          call_logged: "Appel enregistré",
          status_change: "Statut modifié",
          merge: "Fusionnée",
          link_created: "Liée à un célibataire",
          link_removed: "Déliée d'un célibataire",
        },
      },
      tasks: {
        placeholder: "Me rappeler de...",
        dueDate: "Date d'échéance",
        add: "Ajouter un rappel",
        empty: "Aucun rappel sur cette personne.",
      },
      merge: {
        action: "Fusionner les doublons",
        title: "Fusionner dans cette personne",
        description:
          "Tout ce qui appartient au doublon sera transféré vers %{name}. Cette action est irréversible.",
        pick: "Quelle fiche est le doublon ?",
        noCandidates: "Aucun doublon probable trouvé pour cette personne.",
        keeping: "Conservée",
        removing: "Supprimée",
        moving:
          "%{links} célibataires liés, %{interactions} entrées d'historique et %{tasks} rappels ouverts seront transférés.",
        collisionsTitle:
          "Les deux fiches ont un journal d'appels pour %{smart_count} des mêmes célibataires",
        keepWinner: "Garder celle de la fiche conservée",
        keepLoser: "Garder celle du doublon",
        keepBoth: "Garder les deux",
        nothingRecorded: "Rien n'a été noté",
        nothingLost:
          "Quel que soit votre choix, l'autre compte-rendu de l'appel est conservé dans l'historique.",
        resolveFirst: "Résoudre d'abord %{smart_count} conflits",
        confirm: "Fusionner, cette action est irréversible",
        done: "Les deux fiches n'en forment plus qu'une.",
      },
      assistant: {
        title: "Assistant de recherche",
        paid: "Payant",
        upsell:
          "Des questions adaptées à chaque référence, un script d'appel guidé, et une synthèse de ce sur quoi tout le monde s'accorde et de ce qui manque encore.",
        guardrail:
          "Cet assistant organise ce que vous avez appris. Il ne juge jamais la compatibilité et ne suggère jamais de shidduch.",
        questionsTitle: "Questions à poser à %{relationship}",
        captureHint:
          "Utilisez « Enregistrer un appel » sur n'importe quel célibataire lié pour noter les réponses au fur et à mesure.",
        summaryTitle: "Parmi les références auxquelles vous avez parlé",
        covered: "Abordé",
        nothingCovered: "Rien n'a encore été noté.",
        gaps: "Encore manquant",
        noGaps: "Tous les sujets ont été abordés.",
        contradiction: "Les références divergent",
        contradictionDetail:
          "%{warm} ont parlé chaleureusement et %{reserved} ont émis une réserve. Les deux méritent d'être lus en entier.",
        outstanding: "%{smart_count} conversations n'ont pas encore eu lieu.",
      },
    },
    validation: {
      invalid_url: "Doit être une URL valide",
      invalid_linkedin_url: "L'URL doit provenir de linkedin.com",
    },
  },
} satisfies CrmMessages;
