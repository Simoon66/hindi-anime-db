const fs = require('fs');
const { google } = require('googleapis');
const path = require('path');

const { BLOGGER_BLOG_ID, CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, CHANGED_FILES } = process.env;

if (!BLOGGER_BLOG_ID || !CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.log('Skipping Blogger Sync: Missing Credentials');
  process.exit(0);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const blogger = google.blogger({ version: 'v3', auth: oauth2Client });

function generateCode(data, animeId, osLabel = 'Series') {
  const seasonsHtml = (data.seasons || []).map(s => `
  <a href="${s.link || '#'}" class="os-item" title="${s.title}">
    <div class="title">${s.title}</div>
    <div class="season-poster" style="background-image: url(${s.poster});"></div>
  </a>`).join('');

  const episodesJs = (data.episodes || []).map(ep => {
    const filesJs = ep.files.map(f => `    {
      "0": "${f.name}",
      "1": "${f.url}",
      "2": "${f.type || 'sub'}"
    }`).join(',\n');
    const escapedTitle = (ep.title || '').replace(/"/g, '\\"');
    return `  {
    "title": "${escapedTitle}",
    "episode": "${ep.episode}",
    "files": [\n${filesJs}\n    ]
  }`;
  }).join(',\n');

  return `<!--[ Synopsis ]-->
<span style="display:none;" class="blogger-sync-id">id_${animeId}</span>
<div id="synopsis">
<p>${(data.synopsis || '').replace(/\n/g, '<br>')}</p>
</div>

<span><!--more--></span>

<!--[ Thumbnail ]-->
<div class="separator" style="clear: both;"><a href="${data.thumbnail}" style="display: block; padding: 1em 0; text-align: center; "><img alt="" border="0" height="320" src="${data.thumbnail}"/></a></div>

<!--[ Extra information ]-->
<dl id="extra-info">
  <span><dt>Type:</dt><dd>${data.type || ''}</dd></span>
  <span><dt>Synonym:</dt><dd> ${data.synonym || ''} </dd></span>
  <span><dt>Native:</dt><dd>${data.native || ''}</dd></span>
  <span><dt>Aired:</dt><dd> ${data.aired || ''} </dd></span>
  <span><dt>Premiered:</dt><dd>${data.premiered || ''}</dd></span>
  <span><dt>Duration:</dt><dd>${data.duration || ''}</dd></span>
  <span><dt>Episodes:</dt><dd>${data.episodesCount || ''}</dd></span>
</dl>

<div class="os-list" data-host="${data.hostUrl || 'https://megaplay.buzz/stream/ani'}" data-jumlah="${(data.seasons || []).length}" data-label="${osLabel}">
${seasonsHtml}
</div>

<script>
let streamingFiles = [
${episodesJs}
],
streamingId = '${data.streamingId || data.malId || ''}';
</script>`;
}

async function sync() {
  const files = CHANGED_FILES.split(' ').filter(f => f.endsWith('.json'));
  for (const file of files) {
    if (!fs.existsSync(file)) continue; // File deleted
    
    console.log(`Processing ${file}`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const animeId = path.basename(file, '.json');
    const htmlContent = generateCode(data, animeId);
    
    // Convert Aired Date to ISO (for 'published' parameter)
    let publishedDateStr = undefined;
    if (data.releaseDate) {
      const d = new Date(data.releaseDate);
      if (!isNaN(d.getTime())) {
        d.setUTCHours(12);
        publishedDateStr = d.toISOString();
      }
    } else if (data.aired) {
      const parts = data.aired.split('/');
      if (parts.length === 3) { // MM/DD/YYYY
        // Important: set timezone or keep it simple
        const d = new Date(parts[2], parseInt(parts[0])-1, parts[1]);
        if (!isNaN(d.getTime())) {
          d.setUTCHours(12);
          publishedDateStr = d.toISOString();
        }
      }
    }

    // Build labels
    const labels = [...(data.genres || [])];
    if (data.episodesCount) labels.push(`Ep ${data.episodesCount}`);
    if (data.rating) labels.push(data.rating);
    if (data.type) labels.push(data.type);
    labels.push('Series');
    if (data.status) labels.push(data.status);
    if (data.country) labels.push(data.country);

    // Filter duplicates
    const labelToFind = `id_${animeId}`;
    const uniqueLabels = [...new Set(labels.concat([labelToFind]))];

    // Search if post already exists by looking for label id_${animeId}
    let existingPost = null;
    
    try {
      const res = await blogger.posts.search({
        blogId: BLOGGER_BLOG_ID,
        q: labelToFind,
        fetchBodies: true
      });
      if (res.data.items && res.data.items.length > 0) {
        existingPost = res.data.items.find(p => (p.labels || []).includes(labelToFind) || (p.content && p.content.includes(labelToFind)));
      }
    } catch(e) {
      console.log('Search error', e.message);
    }

    if (existingPost) {
      console.log(`Updating post ${existingPost.id} for ${animeId}`);
      try {
        await blogger.posts.patch({
          blogId: BLOGGER_BLOG_ID,
          postId: existingPost.id,
          requestBody: {
            title: data.title,
            content: htmlContent,
            labels: uniqueLabels,
            ...(publishedDateStr ? { published: publishedDateStr } : {})
          }
        });
      } catch (err) {
        console.log('Update Error', err.response ? err.response.data : err.message);
      }
    } else {
      console.log(`Creating new post for ${animeId}`);
      try {
        const createRes = await blogger.posts.insert({
          blogId: BLOGGER_BLOG_ID,
          isDraft: false,
          requestBody: {
            title: animeId,
            content: htmlContent,
            labels: uniqueLabels,
            published: publishedDateStr
          }
        });
        
        console.log(`Created post ${createRes.data.id}. Now updating real title...`);
        await blogger.posts.patch({
          blogId: BLOGGER_BLOG_ID,
          postId: createRes.data.id,
          requestBody: {
            title: data.title
          }
        });
        console.log(`Success! Permalink: ${createRes.data.url}`);
      } catch(e) {
        console.log('Create error', e.response ? JSON.stringify(e.response.data) : e.message);
      }
    }
  }
}
sync();
