module.exports = {
  // The main panel message everyone sees.
  panel: {
    color: 0xf1c40f,
    title: '🛒 Trade Instructions & Info',
    description:
      'Welcome to the **Trade Center**!\n\n' +
      'Use the buttons below to read our trading rules, learn how to check values, and use the trade calculator.',
    thumbnail: '',
  },

  sections: [
    {
      id: 'trade_rules',
      label: 'Trade Rules',
      emoji: '📜',
      style: 'Danger',
      title: '📜 Trading Rules',
      description:
        '**1.** No scamming or sharking. Be fair and honest.\n' +
        '**2.** All trades must be conducted through official game mechanics.\n' +
        '**3.** Do not spam trade requests or beg for items.\n' +
        '**4.** If you are unsure about a trade, ask a staff member or use the `/value` command.\n\n',
    },
    {
      id: 'trade_values',
      label: 'Values',
      emoji: '💰',
      style: 'Primary',
      title: '💰 Trade Values',
      description:
        'You can use the `/value` command to check the official trade value of any item.\n' +
        '**Usage:** `/value item: [Item Name]`\n\n' +
        '*Example:* `/value item: Colossal Serum`\n' +
        'This will show rarity, demand, trend, and the base value in keys.',
    },
    {
      id: 'trade_calculator',
      label: 'Calculator',
      emoji: '🧮',
      style: 'Success',
      title: '🧮 Trade Calculator',
      description:
        'Use the `/tradecalc` command to compare your offer against what you are requesting.\n' +
        '**Usage:** `/tradecalc offer: [Your Items] request: [Their Items]`\n\n' +
        '*Example:* `/tradecalc offer: 2x colossal serum request: 1x founding titan`\n' +
        'The bot will tell you if the trade is a W (Win), F (Fair), or L (Loss).',
    },
  ],
};
