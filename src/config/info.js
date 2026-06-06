module.exports = {
  // The main panel message everyone sees.
  panel: {
    color: 0x5865f2,
    title: '🌙 Moonlight Soldiers — Information',
    description:
      'Welcome to **Moonlight Soldiers**!\n\n' +
      'Use the buttons below to read our rules, guidelines, role info, and how to join the regiment.',
    // Optional image/thumbnail URL (leave '' to disable)
    thumbnail: '',
  },

  // One button per entry. Clicking a button replies privately with its embed.
  sections: [
    {
      id: 'info_rules',
      label: 'Rules',
      emoji: '📜',
      style: 'Danger',
      title: '📜 Server Rules',
      description:
        '**1.** Be respectful — no harassment, hate speech, or drama.\n' +
        '**2.** No spam, self-promotion, or unsolicited DMs.\n' +
        '**3.** Keep channels on-topic.\n' +
        '**4.** Follow Discord\'s Terms of Service.\n' +
        '**5.** Listen to staff.\n\n',
    },
    {
      id: 'info_guidelines',
      label: 'Guidelines',
      emoji: '📘',
      style: 'Primary',
      title: '📘 Community Guidelines',
      description:
        'Add your community/regiment guidelines here.\n\n',
    },
    {
      id: 'info_roles',
      label: 'Roles Info',
      emoji: '🎖️',
      style: 'Secondary',
      title: '🎖️ Roles',
      description:
        '**Cadet** — you\'re an active member of the regiment.\n' +
        '**Recruit** — you\'re on the waiting list for a regiment slot.\n\n' +
        '**Staff:** Premier · Commander · Lieutenant · Sergeant\n\n',
    },
    {
      id: 'info_join',
      label: 'How to Join',
      emoji: '✅',
      style: 'Success',
      title: '✅ Joining the Regiment',
      description:
        'Head to the **#tickets** channel and click **🎖️ Join Regiment**.\n' +
        'If a slot is open you\'ll get the **Cadet** role instantly. If we\'re full, ' +
        'you\'ll be added to the queue as a **Recruit** and promoted automatically when a slot opens.\n\n',
    },
    {
      id: 'info_contact',
      label: 'Contact Staff',
      emoji: '📨',
      style: 'Secondary',
      title: '📨 Contact Staff',
      description:
        'Need help? Open a ticket or mention a staff member.\n\n',
    },
  ],
};
