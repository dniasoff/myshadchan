import type { CrmMessages } from "./englishCrmMessages";

export const frenchCrmMessages = {
  resources: {
    shidduchim: {
      name: "Shidduch |||| Shidduchim",
      forcedCaseName: "Shidduch",
      fields: {
        name_en: "Nom",
        single_id: "Célibataire",
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
    singles: {
      name: "Célibataire |||| Célibataires",
      forcedCaseName: "Célibataire",
      fields: {
        first_name_en: "Prénom",
        last_name_en: "Nom",
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
    members: {
      name: "Utilisateur |||| Utilisateurs",
      fields: {
        first_name: "Prénom",
        last_name: "Nom",
        email: "E-mail",
        administrator: "Admin",
        disabled: "Désactivé",
      },
      edit: {
        error: "Une erreur s'est produite. Veuillez réessayer.",
        record_not_found: "Enregistrement introuvable",
        success: "Utilisateur mis à jour avec succès",
        title: "Modifier %{name}",
      },
    },
    tasks: {
      name: "Tâche |||| Tâches",
      forcedCaseName: "Tâche",
      fields: {
        text: "Description",
        due_date: "Date d'échéance",
        type: "Type",
        due_short: "échéance",
      },
      action: {
        edit: "Modifier la tâche",
      },
      actions: {
        postpone_next_week: "Reporté à la semaine prochaine",
        postpone_tomorrow: "Reporter à demain",
        title: "Actions de tâche",
      },
      deleted: "Tâche supprimée avec succès",
      sheet: {
        edit: "Modifier la tâche",
      },
      empty_list_hint: "Les tâches que vous ajoutez apparaîtront ici.",
      filters: {
        later: "Plus tard",
        overdue: "En retard",
        this_week: "Cette semaine",
        today: "Aujourd'hui",
        tomorrow: "Demain",
      },
      updated: "Tâche mise à jour",
    },
  },
  crm: {
    auth: {
      footer_private: "Privé à votre famille",
      back_to_home: "Retour à l'accueil",
      login: {
        title: "Bon retour",
        subtitle: "Connectez-vous à vos dossiers.",
        send_code: "Envoyer le code",
        code_sent_to: "Nous avons envoyé un code à 6 chiffres à %{email}.",
        code_label: "Code",
        resend_code: "Renvoyer le code",
        code_resent: "Code envoyé à nouveau",
        use_different_email: "Utiliser une autre adresse e-mail",
        invalid_code: "Ce code est incorrect ou a expiré.",
      },
      // Story 2.7 : le flux d'invitation seule (/accept-invite/:token). Pas
      // de formulaire email/mot de passe séparé — l'invité·e confirme
      // seulement 18+ (crm.auth.age_affirmation.* ci-dessous) puis termine
      // la vérification OTP de 2.6.
      invite_title: "Vous avez été invité(e)",
      invite_body:
        "Rejoignez %{accountName} sur MyShadchan en tant que %{role}.",
      invite_sending_code: "Envoi de votre code…",
      invite_expired_title: "Cette invitation a expiré",
      invite_expired_body:
        "Demandez à la personne qui vous a invité(e) une nouvelle invitation.",
      invite_accepted_title: "Cette invitation a déjà été utilisée",
      invite_accepted_body:
        "Connectez-vous plutôt, ou demandez une nouvelle invitation à la personne qui vous a invité(e).",
      invite_revoked_title: "Cette invitation a été révoquée",
      invite_revoked_body:
        "Demandez à la personne qui vous a invité(e) une nouvelle invitation.",
      invite_not_found_title: "Ce lien d'invitation n'est pas valide",
      invite_not_found_body:
        "Demandez à la personne qui vous a invité(e) de vous en envoyer un nouveau.",
      age_affirmation: {
        title: "Avant de commencer",
        body: "MyShadchan conserve des dossiers familiaux privés et sensibles. Il est conçu pour les parents et tuteurs qui gèrent le processus de shidduch au nom de leur foyer.",
        checkbox: "Je confirme avoir 18 ans ou plus.",
        continue: "Continuer",
      },
      onboarding: {
        persona_title: "Qu'est-ce qui vous concerne ?",
        persona_subtitle:
          "Cochez tout ce qui s'applique — vous pourrez en ajouter plus tard depuis les paramètres.",
        persona_single: "Je cherche un shidduch pour moi-même",
        persona_parent: "Je cherche un shidduch pour mes enfants",
        persona_shadchan: "Je suis un(e) marieur(euse) (shadchan)",
        persona_validation: "Cochez au moins une option pour continuer.",
        persona_done_shadchan_body: "Votre carnet de shadchanus est prêt.",
      },
    },
    landing: {
      nav: {
        sign_in: "Se connecter",
      },
      hero: {
        eyebrow: "Registre des shidduchim",
        title_lead: "Un registre du processus de shidduch",
        title_accent: "pour vos célibataires.",
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
          body: "Les CV arrivent par message, par e-mail, en photo, ou sur papier et sont numérisés. Chacun est enregistré et classé auprès du célibataire pour lequel il a été proposé.",
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
          body: "Un CV est saisi pour un célibataire. Si ce nom a déjà été proposé, la proposition antérieure est affichée à ce moment-là.",
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
      added: "ajoutée",
      load_more: "Charger plus",
      misc: "Divers",
      copied: "Copié !",
    },
    image_editor: {
      change: "Changer",
      drop_hint:
        "Déposez un fichier à télécharger ou cliquez pour le sélectionner.",
      editable_content: "Contenu modifiable",
      title: "Télécharger et redimensionner l'image",
      update_image: "Mettre à jour l'image",
    },
    // Story 2.4 : basculer entre les contextes (foyer / shadchanous) actifs —
    // un axe distinct de resources.singles ci-dessus.
    context_switcher: {
      label: "%{name} · %{kind}",
      kind_household: "Foyer",
      kind_shadchanus: "Shadchanous",
      switch_error: "Impossible de changer de contexte. Réessayez.",
      load_error: "Impossible de charger vos contextes.",
      section_title: "Contexte",
      trigger_label: "Changer de contexte : %{context}",
    },
    single_switcher: {
      trigger_label: "Changer de célibataire : %{name}",
    },
    settings: {
      dark_mode_logo: "Logo du mode sombre",
      light_mode_logo: "Logo du mode clair",
      notes: {
        statuses: "Statuts",
      },
      personas_title: "Profils",
      persona_add_error: "Impossible de configurer cela. Réessayez.",
      persona_remove_error_ask_admin:
        "Cet enregistrement est géré par l'administrateur de votre foyer — demandez-lui de faire ce changement.",
      persona_remove_error_only_persona:
        "Vous ne pouvez pas retirer votre seul profil. Ajoutez-en un autre d'abord.",
      persona_remove_error_last_access:
        "Vous êtes la seule personne à pouvoir encore accéder aux données de ce compte — ajoutez un autre membre avant de retirer ceci.",
      persona_remove_error_parent_guard:
        "Un autre administrateur doit gérer les autres célibataires de votre foyer avant que vous puissiez retirer ceci.",
      persona_remove_error_generic: "Impossible de retirer cela. Réessayez.",
      invites_title: "Invitations",
      invites_email_label: "E-mail",
      invites_role_label: "Rôle",
      invites_role_parent_admin: "Parent / admin",
      invites_role_helper: "Assistant",
      invites_role_single: "Célibataire",
      invites_role_shadchan: "Chadchan",
      invites_send_button: "Envoyer l'invitation",
      invites_send_error: "Impossible d'envoyer cette invitation. Réessayez.",
      invites_copy: "Copier",
      invites_copied: "Copié",
      invites_empty: "Aucune invitation envoyée pour l'instant",
      invites_expires_in: "%{role} · expire %{when}",
      invites_status_pending: "En attente",
      invites_status_accepted: "Acceptée",
      invites_status_revoked: "Révoquée",
      invites_status_expired: "Expirée",
      invites_revoke: "Révoquer",
      invites_revoke_error:
        "Impossible de révoquer cette invitation. Réessayez.",
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
          "Impossible de supprimer %{display_name} encore utilisés : %{items}",
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
      title: "Profil",
      updated: "Votre profil a été mis à jour",
      update_error: "Une erreur s'est produite. Veuillez réessayer",
    },
    entity360: {
      tab: {
        overview: "Aperçu",
        activity: "Activité",
        notes: "Notes",
        tasks: "Tâches",
        files: "Fichiers",
        related: "Associés",
        resume: "CV",
        photo: "Photo",
        medical: "Médical",
        diligence: "Vérifications",
        "external-links": "Liens externes",
        shidduchim: "Shidduchim",
        conversations: "Conversations",
        discussions: "Discussions",
        assistant: "Assistant",
      },
      overview: {
        empty: "Aucune information enregistrée pour l'instant.",
      },
      related: {
        loading: "Chargement…",
        error: "Impossible de charger les éléments associés.",
        empty: "Rien pour l'instant.",
      },
      // Story 3.5 — interactionLabels.ts's INTERACTION_KIND_LABELS.
      activity: {
        kind: {
          note: "Note",
          call_logged: "Appel enregistré",
          status_change: "Statut modifié",
          merge: "Fusionnée",
          link_created: "Liée à un shidduch",
          link_removed: "Déliée d'un shidduch",
        },
        empty: "Rien n'a encore été enregistré.",
        error: "Impossible de charger le fil d'activité.",
        viewRecord: "Voir l'enregistrement",
      },
      // Story 3.6 — NotesTab.tsx.
      notes: {
        empty: "Aucune note pour l'instant.",
        error: "Impossible de charger les notes.",
        placeholder: "Ajouter une note…",
        add: "Ajouter une note",
        edit: "Modifier",
        delete: "Supprimer",
        save: "Enregistrer",
        cancel: "Annuler",
        unknownAuthor: "Inconnu",
        addError: "Échec de l'ajout de la note",
        editError: "Échec de la modification de la note",
        deleteError: "Échec de la suppression de la note",
      },
      record_pending: "Chargement…",
      record_unavailable: "Cet enregistrement n'est pas disponible.",
      record_unavailable_link: "Retour à la liste",
      role_pending: "Chargement de vos accès…",
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
