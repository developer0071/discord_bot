const url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR7naBmry1w8WlHFrtpxJ0n3XdgDj5cehW6XxTdJVDPMDivrnOefz83uuFCoYEGd028tjFQ6tcfPyBA/pubhtml';
fetch(url).then(r=>r.text()).then(html=>{
  const regex = /\{"name":"(.*?)","gid":"(.*?)"\}/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    console.log(`Tab: ${match[1]} - GID: ${match[2]}`);
  }
});
