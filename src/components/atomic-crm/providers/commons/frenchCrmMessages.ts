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
        father_en: "Père",
        mother_en: "Mère",
        shul_en: "Shul",
        age: "Âge",
        height: "Taille",
        dob: "Date de naissance",
        background: "Antécédents",
        marital_status: "État civil",
        existing_children_note: "Enfants existants",
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
        continue_with_google: "Continuer avec Google",
        or_divider: "ou",
        no_account: "Vous n'avez pas de compte ?",
        create_account: "Créez-en un",
      },
      google_step: {
        email_label: "E-mail",
        email_required: "Saisissez votre e-mail pour continuer.",
        preparing: "Un instant…",
        back: "Retour",
      },
      google_oauth_not_configured:
        "La connexion Google n'est pas configurée. Demandez à un administrateur d'activer et de configurer le fournisseur Google dans Supabase.",
      oauth_callback: {
        cancelled:
          "Vous avez fermé la fenêtre de connexion Google avant la fin. Aucun compte n'a été créé — revenez quand vous voulez réessayer.",
        not_configured:
          "La connexion Google n'est pas disponible pour le moment. Connectez-vous plutôt avec votre e-mail.",
        generic:
          "Nous n'avons pas pu terminer cette connexion. Réessayez, ou utilisez votre e-mail.",
      },
      register: {
        title: "Créez votre compte",
        subtitle: "Cela ne prend qu'une minute.",
        email_required: "Saisissez votre e-mail pour continuer.",
        sending_code: "Envoi de votre code…",
        have_account: "Vous avez déjà un compte ?",
        sign_in: "Se connecter",
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
      footer: {
        terms: "Conditions d'utilisation",
        privacy: "Politique de confidentialité",
        subprocessors: "Sous-traitants",
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
        terms: "Conditions d'utilisation",
        privacy: "Politique de confidentialité",
        subprocessors: "Sous-traitants",
      },
    },
    common: {
      added: "ajoutée",
      load_more: "Charger plus",
      misc: "Divers",
      copied: "Copié !",
    },
    entity_list: {
      error: "Une erreur s'est produite lors du chargement de cette liste.",
      retry: "Réessayer",
      view_list: "Vue liste",
      view_cards: "Vue cartes",
      view_mode: "Mode d'affichage",
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
      // Story 7.2: la posture par défaut du foyer pour la `visibility` d'une
      // NOUVELLE conversation quand `create_thread()` est appelé sans
      // argument explicite (AD-22 ; FR96/FR99) —
      // settings/CommunicationSection.tsx.
      communication: {
        title: "Communication",
        default_visibility: "Nouvelles conversations",
        default_visibility_hint:
          "Qui peut voir une nouvelle conversation par défaut",
        visibility_open: "Ouvert — tout le foyer",
        visibility_private: "Privé — uniquement les participants",
        save_error: "Impossible d'enregistrer cela. Réessayez.",
        // Story 7.5 — voir la même note dans englishCrmMessages.ts.
        push: {
          title: "Notifications push",
          description:
            "Recevez une notification sur cet appareil quand quelqu'un envoie un message dans une discussion à laquelle vous participez.",
          delivery_notice:
            "Ceci active seulement le côté de cet appareil. La livraison n'est pas encore active — vous ne recevrez donc rien réellement tant qu'elle ne sera pas activée.",
          enable: "Activer sur cet appareil",
          enabling: "Activation…",
          enabled: "Activé sur cet appareil",
          unsupported:
            "Ce navigateur ne prend pas en charge les notifications push (courant sur iOS sauf si l'application est installée sur l'écran d'accueil).",
          demo: "Non disponible dans cette démo — il n'y a pas de livraison à activer derrière.",
          denied_hint:
            "Les notifications sont bloquées pour ce site. Autorisez-les depuis les paramètres du site de votre navigateur, puis réessayez.",
        },
      },
      // Story 10.3 — voir la même note dans englishCrmMessages.ts.
      capture: {
        title: "Capture par e-mail",
        description:
          "Transférez ou mettez en copie tout redt à cette adresse — il arrive directement dans votre boîte de réception.",
        explanation:
          "Toute personne connaissant cette adresse peut vous y écrire. Les messages d'un expéditeur non reconnu attendent dans « À vérifier » jusqu'à ce que vous le confirmiez.",
        copy: "Copier",
        copied: "Copié",
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
      connection_title: "Connexion",
      connection_household_description:
        "Connectez-vous avec le chadchan de votre famille pour qu'il puisse voir les shidduchim de vos célibataires et les redt directement.",
      connection_shadchan_description:
        "Connectez-vous avec une famille pour voir directement ses shidduchim et ses redt.",
      connection_connect_shadchan: "Se connecter avec un chadchan",
      connection_connect_family: "Se connecter avec une famille",
      connection_generate_error:
        "Impossible de créer ce lien d'invitation. Réessayez.",
      connection_end_button: "Mettre fin à la connexion",
      connection_end_error:
        "Impossible de mettre fin à cette connexion. Réessayez.",
      connection_active_status: "Connecté",
      connection_ended_status: "Connexion terminée",
      connection_invite_pending_label: "Lien d'invitation en attente",
      connection_invite_expires: "Expire le %{when}",
      connection_invite_cancel: "Annuler l'invitation",
      connection_invite_revoke_error:
        "Impossible d'annuler cette invitation. Réessayez.",
      listing: {
        title: "Publier mon annonce",
        description:
          "Choisissez ce que les familles peuvent trouver à votre sujet, champ par champ. Rien n'est affiché tant que vous ne l'activez pas.",
        name_label: "Nom",
        name_placeholder: "Comment les familles verront votre nom",
        area_label: "Zone",
        area_placeholder: "ex. Lakewood et les environs",
        contact_label: "Comment me joindre",
        contact_placeholder:
          "Téléphone, e-mail, ou la façon dont vous préférez être contacté",
        name_required_error:
          "Activez « Nom » et saisissez un nom avant de publier.",
        publish_button: "Publier mon annonce",
        update_button: "Mettre à jour l'annonce",
        publish_success: "Votre annonce est en ligne.",
        publish_error: "Impossible de publier votre annonce. Réessayez.",
        withdraw_button: "Retirer l'annonce",
        withdraw_success: "Votre annonce a été retirée.",
        withdraw_error: "Impossible de retirer votre annonce. Réessayez.",
        // Story 9.3 — voir la même note dans englishCrmMessages.ts.
        consent_button: "Autoriser la republication",
        consent_success:
          "Vous avez donné votre consentement — cette annonce peut être republiée.",
        consent_error: "Impossible de traiter votre consentement. Réessayez.",
      },
      // Story 9.2 — voir la même note dans englishCrmMessages.ts.
      single_listing: {
        title: "Annonces des célibataires",
        description:
          "Publiez un profil restreint, avec consentement explicite, pour que les shadchanim puissent le trouver.",
        empty: "Aucun célibataire dans ce foyer pour l'instant.",
        publish_button: "Publier",
        manage_button: "Gérer l'annonce",
        dialog_title: "Publier une annonce pour %{name}",
        // Story 9.5 — voir la même note dans englishCrmMessages.ts.
        share_button: "Partager",
      },
      // Story 9.2 — voir la même note dans englishCrmMessages.ts.
      single_listing_form: {
        first_name_en_label: "Prénom (anglais)",
        first_name_en_placeholder: "Comment les shadchanim verront son prénom",
        first_name_he_label: "Prénom (hébreu)",
        first_name_he_placeholder: "שם פרטי",
        age_label: "Âge",
        age_placeholder: "ex. 24",
        height_label: "Taille",
        height_placeholder: "ex. 1,68 m",
        community_label: "Communauté",
        community_placeholder: "ex. Yeshivish, orthodoxe moderne",
        location_label: "Lieu",
        location_placeholder: "ex. Lakewood, NJ",
        summary_label: "Résumé",
        summary_placeholder:
          "Tout ce que les champs fixes ci-dessus ne couvrent pas",
        name_required_error:
          "Activez un prénom en anglais ou en hébreu et saisissez-le avant de publier.",
        publish_button: "Publier l'annonce",
        update_button: "Mettre à jour l'annonce",
        publish_success: "L'annonce est en ligne.",
        publish_error: "Impossible de publier l'annonce. Réessayez.",
        // Story 9.3 — voir la même note dans englishCrmMessages.ts.
        locked_error:
          "Ce célibataire a retiré cette annonce et doit consentir à nouveau avant qu'elle puisse être republiée.",
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
          "Impossible de supprimer %{display_name} encore utilisés : %{items}",
        validating: "Validation\u2026",
        entities: {
          categories: "catégories",
          stages: "étapes",
        },
      },
      privacy: {
        terms_link: "Conditions d'utilisation",
        privacy_link: "Politique de confidentialité",
        subprocessors_link: "Sous-traitants",
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
      connections: "Connexions",
    },
    global_search: {
      trigger_label: "Rechercher",
      title: "Rechercher",
      description:
        "Rechercher parmi les célibataires, shidduchim et chadchanim",
      placeholder: "Rechercher célibataires, shidduchim, chadchanim…",
      hint: "Rechercher célibataires, shidduchim, chadchanim…",
      loading: "Recherche en cours…",
      no_results: "Aucun résultat",
      error:
        "Une erreur est survenue pendant la recherche. Veuillez réessayer.",
      partial_error:
        "Certains résultats sont peut-être manquants — une partie de la recherche a échoué.",
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
        // Story 6.4 — SingleInputForm.tsx.
        singleInput: {
          heading: "Partagez votre avis",
          placeholder: "Que pensez-vous de cette suggestion ?",
          submit: "Envoyer",
          error: "Échec de l'envoi de votre avis",
        },
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
          single_input: "La saisie du célibataire",
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
      // Story 3.8 — TasksTab.tsx and TasksRailSummary.tsx.
      tasks: {
        empty: "Aucune tâche pour l'instant.",
        error: "Impossible de charger les tâches.",
        placeholder: "Ajouter une tâche…",
        dueDate: "Date d'échéance",
        add: "Ajouter une tâche",
        addError: "Échec de l'ajout de la tâche",
        toggleError: "Échec de la mise à jour de la tâche",
        viewAll: "Voir toutes les tâches",
      },
      // Story 3.7 — FilesTab.tsx.
      files: {
        empty: "Aucun fichier pour l'instant.",
        error: "Impossible de charger les fichiers.",
        upload: "Ajouter un fichier",
        uploadError: "Échec de l'ajout du fichier",
        download: "Télécharger",
        downloadError: "Échec de la génération du lien de téléchargement",
        replace: "Remplacer",
        replaceError: "Échec du remplacement du fichier",
        delete: "Supprimer",
        deleteError: "Échec de la suppression du fichier",
        visibility: "Visibilité",
        visibilityError: "Échec de la mise à jour de la visibilité",
        visibilityOption: {
          shared: "Partagé",
          private_parent: "Parents uniquement",
          private_single: "Célibataire uniquement",
        },
      },
      // Story 5.3 — ResumeTab.tsx.
      resume: {
        empty: "Aucun CV téléversé pour l'instant.",
        error: "Impossible de charger le CV.",
        upload: "Téléverser une nouvelle version",
        uploadError: "Échec du téléversement du CV",
        download: "Télécharger",
        downloadError: "Échec de la génération du lien de téléchargement",
      },
      // Story 5.4 — PhotoTab.tsx / PhotoRevealCard.tsx.
      photo: {
        empty: "Aucune photo téléversée pour l'instant.",
        error: "Impossible de charger les photos.",
        upload: "Téléverser une photo",
        uploadError: "Échec du téléversement de la photo",
        reveal: "Révéler",
        revealError: "Échec de la révélation de la photo",
        hide: "Masquer",
        hideError: "Échec du masquage de la photo",
        alt: "Photo",
        visibilityOption: {
          shared: "Partagé",
          private_parent: "Parents uniquement",
        },
      },
      // Story 5.5 — MedicalTab.tsx.
      medical: {
        empty: "Aucune note médicale pour l'instant.",
        error: "Impossible de charger les notes médicales.",
        placeholder: "Ajouter une note médicale…",
        add: "Ajouter une note",
        addError: "Échec de l'ajout de la note",
      },
      // Story 5.6 — ExternalLinksTab.tsx.
      "external-links": {
        empty: "Aucun lien externe pour l'instant.",
        error: "Impossible de charger les liens externes.",
        urlPlaceholder: "https://exemple.com/profil",
        labelPlaceholder: "Libellé (facultatif)",
        add: "Ajouter un lien",
        addError: "Échec de l'ajout du lien",
        invalidUrl: "Saisissez une URL valide (avec https://).",
        remove: "Supprimer",
        removeError: "Échec de la suppression du lien",
      },
      // Story 5.7 — le panneau latéral du shidduch.
      rail: {
        singleInput: {
          heading: "La saisie du célibataire",
          empty: "Rien n'a encore été partagé.",
          error: "Impossible de charger la saisie du célibataire.",
        },
        reminders: {
          heading: "Rappels",
        },
        forward: {
          action: "Transférer le CV",
          noResume: "Aucun CV à transférer pour l'instant.",
          error: "Échec du transfert du CV",
        },
      },
      record_pending: "Chargement…",
      record_unavailable: "Cet enregistrement n'est pas disponible.",
      record_unavailable_link: "Retour à la liste",
      record_unavailable_home_link: "Retour au tableau de bord",
      role_pending: "Chargement de vos accès…",
    },
    singles: {
      list: {
        eyebrow: "Registre familial",
        subtitle:
          "Chaque célibataire pour qui vous faites des propositions, avec son propre parcours.",
        createLabel: "Ajouter un célibataire",
        searchPlaceholder: "Rechercher par nom",
        emptyTitle: "Ajoutez votre premier célibataire",
        emptyDescription:
          "Un parcours de shidduchim appartient à un célibataire — la personne pour qui vous faites des propositions. Ajoutez un célibataire pour commencer à suivre les propositions.",
        subtitleSelfManaged:
          "Votre propre parcours de shidduchim, réuni au même endroit.",
        emptyDescriptionSelfManaged:
          "C'est ici que vivra votre propre parcours de shidduchim. Ajoutez votre fiche pour commencer à suivre les propositions.",
        noMatches: "Aucun célibataire ne correspond à cette recherche.",
      },
      loginInvite: {
        action: "Donner à %{name} son propre accès",
        description:
          "%{name} pourra se connecter et voir ce que vous partagez avec lui/elle.",
        emailLabel: "E-mail",
        sendButton: "Envoyer l'invitation",
        sendError: "Impossible d'envoyer cette invitation. Réessayez.",
        linkedIndicator: "A son propre accès",
      },
    },
    shadchanim: {
      list: {
        eyebrow: "Carnet des marieurs",
        subtitle:
          "Chaque marieur(euse) avec qui votre famille a travaillé, réuni dans un même carnet.",
        createLabel: "Ajouter un shadchan",
        searchPlaceholder: "Rechercher par nom",
        emptyTitle: "Ajoutez votre premier shadchan",
        emptyDescription:
          "Chaque proposition vient de quelque part — tenez un carnet des marieurs avec qui votre famille travaille.",
        noMatches: "Aucun shadchan ne correspond à cette recherche.",
      },
      row: {
        shidduchimCount:
          "%{smart_count} shidduch |||| %{smart_count} shidduchim",
      },
    },
    // Story 4.3, AC 1 — see englishCrmMessages.ts for full context.
    shidduchim: {
      pageView: {
        label: "Affichage du pipeline",
        board: "Vue tableau",
        list: "Vue liste",
        cards: "Vue cartes",
      },
    },
    references: {
      index: {
        eyebrow: "À rattacher",
        title: "Références non rattachées",
        subtitle:
          "Personnes enregistrées sans shidduch. Rattachez chacune au shidduch dont vous leur avez parlé : elles seront ensuite accessibles depuis celui-ci.",
        empty:
          "Rien à trier — chaque référence appartient à un shidduch. Une référence se consulte depuis le shidduch concerné, jamais séparément.",
        emptyLink: "Aller au pipeline",
      },
      attach: {
        action: "Rattacher à un shidduch",
        title: "Rattacher à un shidduch",
        description:
          "%{name} ne fait partie d'aucun shidduch. Choisissez celui dont vous lui avez parlé.",
        noShidduchim: "Il n'y a encore aucun shidduch auquel la rattacher.",
        done: "Rattachée. Cette personne appartient désormais à un shidduch.",
      },
      create: {
        requires_shidduch:
          "Une référence ne peut être créée que depuis un shidduch.",
        requires_shidduch_link: "Aller au pipeline",
        linked: "Référence enregistrée et rattachée à ce shidduch.",
      },
      header: {
        progress: "%{contacted} conversations sur %{total} effectuées",
        relationshipNote:
          "Affichée par célibataire ci-dessous lorsqu'elle diffère.",
      },
      shidduch: {
        empty: "Personne n'a encore été interrogé au sujet de ce célibataire.",
        add: "Ajouter une référence",
        firstConversation: "Première conversation",
        repeatConversation: "Déjà contactée",
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
        questionsTitle: "Questions à poser",
        questionsToggle: "Afficher les questions",
        questionsToggleHide: "Masquer les questions",
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
      },
    },
    diligence: {
      dossier: {
        title: "Synthèse des références",
        paid: "Payant",
        upsell:
          "Voyez ce sur quoi tout le monde s'accorde, où les avis divergent, et ce que personne n'a demandé.",
        consensus: "Consensus",
        nothingRecorded: "Rien n'a encore été noté.",
        consensusDetail:
          "%{warm} ont parlé chaleureusement, %{reserved} ont émis une réserve.",
        covered: "Abordé",
        nothingCovered: "Rien n'a encore été noté.",
        gaps: "Encore manquant",
        noGaps: "Tous les sujets ont été abordés.",
        // Story 11-1 review fix (Finding 13): renamed from `contradiction`
        // to match the English catalogue's `mixedSentiment` key.
        mixedSentiment: "Sentiments partagés",
        narrative: "Synthèse",
        error: "Impossible de charger la synthèse. Veuillez réessayer.",
        guardrail:
          "Cette synthèse organise ce que vous avez appris. Elle ne juge jamais la compatibilité et ne suggère jamais de shidduch.",
      },
    }, // Story 7.1 — l'onglet Discussions (ThreadList/ThreadPanel,
    // shidduchim/ShidduchDiscussionsTab). Voir la même note dans
    // englishCrmMessages.ts.
    threads: {
      list: {
        empty: "Aucune discussion pour l'instant.",
        error: "Impossible de charger les discussions.",
        start: "Démarrer une discussion",
        startError: "Échec du démarrage de la discussion",
        rowOpen: "Ouverte",
        rowPrivate: "Privée",
      },
      panel: {
        empty: "Aucun message pour l'instant.",
        error: "Impossible de charger les messages.",
        placeholder: "Écrire un message…",
        send: "Envoyer",
        sendError: "Échec de l'envoi du message",
        // Story 7.5 — voir la même note dans englishCrmMessages.ts.
        markReadError: "Échec du marquage de cette discussion comme lue",
      },
      // Story 7.3 — voir la même note dans englishCrmMessages.ts.
      visibility: {
        lock: "Rendre privée",
        lockDescription:
          "Seules les personnes de cette discussion pourront la voir — invisible pour le reste du foyer.",
        unlock: "Rendre ouverte",
        unlockDescription:
          "Toute personne du foyer pouvant déjà voir le sujet de cette discussion pourra la lire.",
        updateError:
          "Échec de la mise à jour de la confidentialité de cette discussion",
      },
    },
    reminders: {
      outstandingCalls: {
        title: "Encore à appeler",
        subtitle: "%{smart_count} conversations n'ont pas encore eu lieu.",
        about: "à propos de",
        overflow: "et %{smart_count} de plus",
      },
      // Story 12.1 — see the matching note in englishCrmMessages.ts.
      dueCard: {
        title: "À faire maintenant",
        subtitle:
          "Ce qui est à faire pour votre famille, du plus urgent au moins urgent.",
        empty: "Rien à faire — tout est à jour",
        since: "Depuis %{when}",
        due: "Prévu %{when}",
        about: "à propos de",
        overflow: "et %{smart_count} de plus",
        seeAll: "Voir tous les rappels",
      },
      // Story 12.2 — see the matching note in englishCrmMessages.ts.
      deliveryStatus: {
        label: "E-mails de rappel",
        notSetUp: "Pas encore configuré",
        sending: "Envoi en cours",
        // Epic 12 review fix (R3) — see the matching note in
        // englishCrmMessages.ts.
        failing: "Échec de la livraison",
        paused: "En pause",
        fetchError: "Impossible de vérifier",
      },
    },
    // Story 12.3 — see the matching note in englishCrmMessages.ts.
    tasks: {
      assignee: {
        label: "Assigné à",
        unassigned: "Non assigné",
        you: "Vous",
        everyone: "Tout le monde",
        mine: "Assigné à moi",
        scope_group: "Portée des tâches",
        former_member: "Ne fait plus partie de ce foyer",
        reassign: "Réassigner",
      },
    },
    validation: {
      invalid_url: "Doit être une URL valide",
      invalid_linkedin_url: "L'URL doit provenir de linkedin.com",
    },
    shadchanus_context: {
      eyebrow: "Shadchanous",
    },
    shadchan_dashboard: {
      title: "Votre espace shadchanous",
      empty_title: "Rien pour l'instant",
      empty_description:
        "Une fois connecté(e) à une famille, ses conversations apparaîtront ici.",
      stats: {
        connections: "Connexions",
        unread: "Conversations non lues",
      },
      recent_title: "Connexions récemment actives",
      connectedSince: "Connecté(e) depuis le %{date}",
    },
    connection_accept: {
      title: "Se connecter avec %{name}",
      description: "%{name} souhaite se connecter avec vous sur MyShadchan.",
      accept_button: "Accepter",
      invalid_title: "Ce lien d'invitation n'est pas valide",
      invalid_description:
        "Il a peut-être expiré, déjà été utilisé, ou été révoqué. Demandez un nouveau lien à la personne qui vous l'a envoyé.",
      error: "Impossible d'accepter cette invitation. Réessayez.",
    },
    inbox: {
      source_shadchan: "Shadchan",
      senderNeedsConfirmation: "Qui a envoyé ceci ?",
      tabs: {
        working: "Boîte de réception",
        needsReview: "À vérifier",
      },
      needsReview: {
        cta: "Vérifier cet expéditeur →",
        emptyTitle: "Rien à vérifier",
        emptyDescription:
          "Les messages d'un expéditeur non reconnu pour ce foyer attendent ici jusqu'à ce que vous le confirmiez.",
        dialogTitle: "Vérifier cet expéditeur",
        dialogDescription:
          "Ce message provient d'une personne que nous ne reconnaissons pas encore pour ce foyer. Lui faire confiance permet à ce message — et à tout autre message déjà en attente de la même adresse — d'entrer dans votre boîte de réception.",
        trustTargetNotice:
          "Faire confiance autorisera aussi les futurs messages de %{email}.",
        senderUnknownNotice:
          "Nous n'avons pas d'adresse de retour enregistrée pour ce message, donc rien à approuver pour l'instant. Vous pouvez toujours l'ignorer.",
        trustSender: "Faire confiance",
        trusting: "Confirmation…",
        discard: "Ignorer",
        discarding: "Suppression…",
        trusted:
          "Confirmé — ce message est maintenant dans votre boîte de réception",
        trustedWithReleased:
          "Confirmé — ce message et %{smart_count} autre message en attente sont maintenant dans votre boîte de réception |||| Confirmé — ce message et %{smart_count} autres messages en attente sont maintenant dans votre boîte de réception",
        trustError: "Impossible de confirmer cet expéditeur. Réessayez.",
        discarded: "Ignoré — rien n'a été enregistré",
        discardError: "Impossible d'ignorer ce message",
      },
      parse: {
        autoFill: "Remplir automatiquement depuis le CV",
        lowConfidence: "Veuillez vérifier",
      },
      share: {
        title: "Enregistrer ce partage",
        sourceLabel: "D'où cela provient",
        loading: "Enregistrement de votre partage…",
        noPreview: "Aucun texte — voir le fichier joint.",
        shadchanLabel: "Shadchan",
        shadchanHelper: "Facultatif — qui a suggéré ce match",
        singleLabel: "Pour quel célibataire ?",
        linkLabel: "Ou lier à une suggestion existante",
        skip: "Passer — le déposer dans ma boîte de réception",
        save: "Enregistrer et examiner",
        saved: "Enregistré comme suggestion",
        linked: "Lié à la suggestion existante",
        skipped: "Partagé dans votre boîte de réception",
        saveError: "Impossible d'enregistrer ce partage",
        pickSingleError: "Choisissez pour quel célibataire c'est",
        fileReadError:
          "Impossible de charger le fichier partagé — vous pouvez tout de même l'enregistrer sans lui.",
      },
      linkSearch: {
        placeholder: "Ou lier à une suggestion existante…",
        label: "Rechercher vos suggestions",
        loading: "Recherche en cours…",
        empty: "Aucune suggestion correspondante.",
        searchError:
          "Impossible de rechercher vos suggestions — essayez une autre recherche.",
        onBoard: "déjà sur le tableau",
        link: "Lier",
      },
    },
    redt_compose: {
      title: "Envoyer un redt",
      description:
        "Décrivez la suggestion — la famille la confirme de son côté avant qu'elle n'entre dans son pipeline.",
      subject_label: "Sujet (facultatif)",
      subject_placeholder: "ex. Une suggestion pour Rivky",
      text_label: "La suggestion",
      text_placeholder:
        "Qui vous avez en tête, et pourquoi c'est un bon profil…",
      submit: "Envoyer le redt",
      success: "Redt envoyé",
      error: "Impossible d'envoyer ce redt. Réessayez.",
    },
    connections: {
      list: {
        eyebrow: "Shadchanous",
        subtitle: "Toutes les familles connectées avec vous, au même endroit.",
        searchPlaceholder: "Rechercher par nom de famille",
        emptyTitle: "Aucune connexion pour l'instant",
        emptyDescription:
          "Une fois qu'une famille se connecte avec vous, elle apparaîtra ici — envoyez-lui une invitation depuis les paramètres pour commencer.",
        noMatches: "Aucune connexion ne correspond à cette recherche.",
      },
      header: {
        connectedSince: "Connecté(e) depuis le %{date}",
      },
      status: {
        accepted: "Acceptée",
        ended: "Terminée le %{date}",
        ended_short: "Terminée",
      },
      stats: {
        redtsSent: "Redts envoyés",
      },
      overview: {
        proposedBy: "Proposée par",
        proposedByHousehold: "La famille",
        proposedByShadchan: "Vous",
        endedAt: "Terminée",
      },
      sendRedt: {
        button: "Envoyer un redt",
        disabledReason:
          "Cette connexion est terminée — un redt ne peut plus être envoyé par ce biais.",
      },
      end: {
        button: "Terminer la connexion",
        confirmTitle: "Terminer cette connexion ?",
        confirmDescription:
          "Cette action est immédiate et irréversible. Son historique reste visible, mais un redt ne peut plus être envoyé par ce biais.",
        confirmButton: "Terminer la connexion",
        error: "Impossible de terminer cette connexion. Réessayez.",
      },
    },
    // Story 14.1 — Legal surfaces (terms/privacy/sub-processors).
    legal: {
      terms: {
        title: "Conditions d'utilisation",
        last_updated: "Dernière mise à jour : 2026-08-09 (v1)",
        acceptance: {
          title: "1. Acceptation des conditions",
          body: "En accédant à MyShadchan ou en l'utilisant, vous acceptez d'être lié par ces conditions. Si vous n'êtes pas d'accord, n'utilisez pas le service.",
        },
        accounts: {
          title: "2. Comptes",
          body: "Vous devez avoir 18 ans ou plus pour créer un compte. Vous êtes responsable de la sécurité de vos identifiants et de toute activité sous votre compte. Les comptes sont par famille/foyer ; vous pouvez inviter des membres supplémentaires.",
        },
        data: {
          title: "3. Vos données",
          body: "Vous êtes propriétaire des enregistrements que vous créez. MyShadchan ne met pas vos données en commun avec d'autres familles, ne les utilise pas pour entraîner des modèles et ne les vend pas. Vous pouvez exporter ou supprimer vos données à tout moment depuis Paramètres → Confidentialité.",
        },
        usage: {
          title: "4. Utilisation acceptable",
          body: "Vous ne pouvez pas utiliser le service à des fins illégales, pour harceler qui que ce soit, ou pour interférer avec son fonctionnement. Nous pouvons suspendre ou résilier l'accès en cas de violation.",
        },
        availability: {
          title: "5. Disponibilité et modifications",
          body: 'Le service est fourni "tel quel" sans garanties. Nous pouvons modifier ou interrompre des fonctionnalités avec un préavis raisonnable. Ces conditions peuvent être mises à jour ; l\'utilisation continue vaut acceptation.',
        },
        limitation: {
          title: "6. Limitation de responsabilité",
          body: "Dans toute la mesure permise par la loi, MyShadchan et ses opérateurs ne sont pas responsables des dommages indirects, accessoires ou consécutifs découlant de votre utilisation du service.",
        },
        contact: {
          title: "7. Contact",
          body: "Des questions sur ces conditions ? Contactez-nous via le canal de commentaires dans l'application ou à legal@myshadchan.example.",
        },
        footer_note:
          "Le code est public. Le service est gratuit, assuré à prix coûtant.",
      },
      privacy: {
        title: "Politique de confidentialité",
        last_updated: "Dernière mise à jour : 2026-08-09 (v1)",
        controller: {
          title: "1. Responsable du traitement",
          body: "MyShadchan (exploité par le projet MyShadchan) est le responsable du traitement des données personnelles que vous fournissez en utilisant le service. Contact : legal@myshadchan.example.",
        },
        data_collected: {
          title: "2. Données collectées",
          body: "Nous ne collectons que ce que vous fournissez explicitement : email du compte, noms des membres de la famille, dossiers de shidduch, personnes de référence, notes, tâches et fichiers téléversés. Nous ne collectons pas d'analytiques, de pixels de suivi, ni de cookies tiers.",
        },
        purpose: {
          title: "3. Finalité et base légale",
          body: "Vos données sont traitées uniquement pour fournir le service de gestion des shidduchim (exécution du contrat) et respecter les obligations légales (ex. vérification de l'âge). Aucun profilage, prise de décision automatisée ou utilisation marketing n'a lieu.",
        },
        sharing: {
          title: "4. Partage et sous-traitants",
          body: "Vos données ne sont jamais vendues. Elles sont partagées uniquement avec les sous-traitants listés sur notre page Sous-traitants (infrastructure, livraison d'email, paiements, inférence IA) et seulement si nécessaire pour faire fonctionner le service. Chacun a un accord de traitement des données en place.",
        },
        rights: {
          title: "5. Vos droits",
          body: "Vous pouvez accéder, rectifier, exporter ou supprimer vos données à tout moment depuis Paramètres → Confidentialité. Vous pouvez aussi vous opposer au traitement ou en demander la limitation. Nous répondons sous 30 jours.",
        },
        retention: {
          title: "6. Conservation",
          body: "Les données sont conservées tant que votre compte est actif. À la suppression, elles sont retirées du stockage principal sous 30 jours et des sauvegardes sous 90 jours.",
        },
        security: {
          title: "7. Sécurité",
          body: "Les données sont chiffrées en transit (TLS 1.2+) et au repos (AES-256). L'accès est limité au personnel autorisé. Nous effectuons des analyses de vulnérabilité régulières et maintenons un plan de réponse aux incidents.",
        },
        contact: {
          title: "8. Contact",
          body: "Questions ou demandes de confidentialité : legal@myshadchan.example. Vous avez également le droit d'introduire une réclamation auprès de votre autorité de contrôle.",
        },
        footer_note:
          "Le code est public. Le service est gratuit, assuré à prix coûtant.",
      },
      subprocessors: {
        title: "Sous-traitants",
        version: "v1 · 2026-08-09",
        note: "Dérivé du déploiement — à mettre à jour si l'infrastructure change.",
        intro:
          "Les sous-traitants suivants traitent des données personnelles pour notre compte afin de fournir le service MyShadchan. Chacun a un accord de traitement des données (DPA) en place incorporant des clauses contractuelles types lorsque requis.",
        purpose_label: "Finalité",
        location_label: "Localisation des données",
        dpa_badge: "DPA en place",
        changes: {
          title: "Modifications de cette liste",
          body: "Nous vous informerons via une bannière dans l'application et par email au moins 30 jours avant l'ajout d'un nouveau sous-traitant. Vous pouvez vous opposer en contactant legal@myshadchan.example ; si nous ne pouvons pas donner suite à l'opposition, vous pouvez résilier votre compte et exporter vos données.",
        },
        footer_note:
          "Le code est public. Le service est gratuit, assuré à prix coûtant.",
      },
    },
  },
} satisfies CrmMessages;
