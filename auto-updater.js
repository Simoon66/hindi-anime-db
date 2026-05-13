// auto-updater.js
const fs = require('fs');
const path = require('path');

const ANILIST_API = 'https://graphql.anilist.co';

const QUERY = `
query($sort: [MediaSort], $perPage: Int) {
  Page(perPage: $perPage, page: 1) {
    media(sort: $sort, type: ANIME, isAdult: false) {
      id idMal title { userPreferred english romaji } format status episodes description coverImage { large extraLarge } startDate { year month day } genres countryOfOrigin studios(isMain: true) { nodes { name } }
      relations { edges { relationType node { id type format title { userPreferred romaji english } coverImage { large } startDate { year month day } } } }
    }
  }
}
`;

function formatStatus(status) {
  if (status === 'RELEASING') return 'Ongoing';
  if (status === 'FINISHED') return 'Completed';
  if (status === 'NOT_YET_RELEASED') return 'Upcoming';
  return status || 'Completed';
}

function formatType(format) {
  if (format === 'TV') return 'TV Series';
  if (format === 'MOVIE') return 'Movie';
  if (format === 'OVA') return 'OVA';
  if (format === 'ONA') return 'ONA';
  if (format === 'SPECIAL') return 'Special';
  return format || 'TV Series';
}

function getMegaPlayServers(id, epNum, type = 'ani') {
  const servers = [];
  if (type === 'ani' || type === 'mal') {
    const endpoint = type === 'ani' ? 'ani' : 'mal';
    const sourceName = type === 'ani' ? 'HD-1' : 'HD-2';
    servers.push({ name: sourceName, url: `https://megaplay.buzz/stream/${endpoint}/${id}/${epNum}/sub`, type: 'sub' });
    servers.push({ name: sourceName, url: `https://megaplay.buzz/stream/${endpoint}/${id}/${epNum}/dub`, type: 'dub' });
  }
  return servers;
}

const getInitialData = () => ({
  title: '', synopsis: '', thumbnail: '', synonym: '', native: '',
  aired: '', premiered: '', duration: '', episodesCount: '', genres: [],
  rating: '', type: '', status: '', country: '', studios: [], producers: [],
  seasons: [], episodes: [], streamingId: '', releaseDate: '', malId: ''
});

async function processAnimeList(mediaList) {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  for (const ani of mediaList) {
    const allowedRelations = ['PREQUEL', 'SEQUEL', 'SPIN_OFF', 'SIDE_STORY', 'ALTERNATIVE', 'PARENT', 'SUMMARY'];
    const relatedEdges = (ani.relations?.edges || []).filter(e => allowedRelations.includes(e.relationType) && e.node.type === 'ANIME');
    
    const seasons = [];
    
    for (const rel of relatedEdges) {
        const node = rel.node;
        const sYr = node.startDate?.year || '0000';
        const sMo = (node.startDate?.month || 0).toString().padStart(2, '0');
        const typeStr = formatType(node.format || '');
        seasons.push({
            title: `[${typeStr}] ${node.title.english || node.title.romaji || node.title.userPreferred}`,
            link: `/${sYr}/${sMo}/${node.id}.html`,
            poster: node.coverImage?.large || ''
        });
    }
    
    const curYr = ani.startDate?.year || '0000';
    const curMo = (ani.startDate?.month || 0).toString().padStart(2, '0');
    const curTypeStr = formatType(ani.format || '');
    seasons.unshift({
        title: `[${curTypeStr}] ${ani.title.english || ani.title.romaji || ani.title.userPreferred}`,
        link: `/${curYr}/${curMo}/${ani.id}.html`,
        poster: ani.coverImage?.extraLarge || ani.coverImage?.large || ''
    });
    
    const year = ani.startDate?.year || '';
    const month = ani.startDate?.month?.toString().padStart(2, '0') || '01';
    
    const episodes = [];
    const epsCount = ani.episodes || 0;
    for (let ep = 1; ep <= epsCount; ep++) {
        const epStr = ep.toString();
        const files = getMegaPlayServers(ani.id.toString(), epStr, 'ani');
        if (ani.idMal) {
            files.push(...getMegaPlayServers(ani.idMal.toString(), epStr, 'mal'));
        }
        episodes.push({ title: `Episode ${ep}`, episode: epStr, files: files });
    }

    const animeData = {
      ...getInitialData(),
      hostUrl: "https://megaplay.buzz/stream/ani",
      streamingId: ani.id.toString(),
      title: ani.title.english || ani.title.romaji || ani.title.userPreferred,
      thumbnail: ani.coverImage.extraLarge || ani.coverImage.large,
      status: formatStatus(ani.status),
      releaseDate: `${year}-${month}-${ani.startDate?.day?.toString().padStart(2, '0') || '01'}`,
      episodesCount: epsCount.toString(),
      synopsis: ani.description?.replace(/<br>/g, '\\n').replace(/<[^>]*>/g, '') || '',
      genres: ani.genres || [],
      type: formatType(ani.format || ''),
      country: ani.countryOfOrigin || '',
      studios: ani.studios?.nodes?.map(n => n.name) || [],
      seasons: seasons,
      episodes: episodes
    };
    
    const filePath = path.join(dataDir, `${ani.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(animeData, null, 2));
  }
}

async function fetchFromAnilist(sort, perPage) {
  const response = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { sort: [sort], perPage } })
  });
  const json = await response.json();
  if (json.errors) {
    console.error("Error from AniList:", json.errors);
    return [];
  }
  return json.data.Page.media;
}

async function run() {
  console.log("Fetching Trending...");
  const trending = await fetchFromAnilist('TRENDING_DESC', 50); // Trending 50
  await processAnimeList(trending);
  
  console.log("Fetching Popular...");
  const popular = await fetchFromAnilist('POPULARITY_DESC', 50); // Popular 50
  await processAnimeList(popular);

  console.log("Fetching Top 100...");
  const top100 = await fetchFromAnilist('SCORE_DESC', 100); // Top 100
  await processAnimeList(top100);

  console.log("All updates completed!");
}

run();
