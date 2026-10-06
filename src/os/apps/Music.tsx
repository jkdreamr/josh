import { useState } from 'react';
import { embeds, links, soundcloudAvatar } from '../data';
import { useOS, type AppProps } from '../types';
import { ExternalIcon } from '../util';

function Frame({ src, title, height }: { src: string; title: string; height?: number }) {
  const [ready, setReady] = useState(false);
  return (
    <div className={`embed ${ready ? 'is-ready' : ''}`} style={height ? { height } : undefined}>
      {!ready && <div className="embed-skel" />}
      <iframe src={src} title={title} loading="lazy" onLoad={() => setReady(true)} allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />
    </div>
  );
}

export function SoundCloud(_: AppProps) {
  return (
    <div className="sc">
      <div className="sc-hero">
        <img src={soundcloudAvatar} alt="kelix on SoundCloud" width={84} height={84} />
        <div>
          <h2>kelix</h2>
          <p>stanford · 19</p>
          <a className="btn btn-sc" href={links.soundcloud} target="_blank" rel="noreferrer">
            Follow on SoundCloud <ExternalIcon size={11} />
          </a>
        </div>
      </div>
      <Frame src={embeds.soundcloud} title="kelix on SoundCloud" />
    </div>
  );
}

export function Spotify(_: AppProps) {
  const os = useOS();
  return (
    <div className="spotify">
      <div className="sp-hero">
        <small>ALBUM</small>
        <h2>all i need</h2>
        <p>
          <a href={links.spotifyAlbum} target="_blank" rel="noreferrer">
            open in Spotify <ExternalIcon size={10} />
          </a>
        </p>
      </div>
      <Frame src={embeds.spotify} title="all i need on Spotify" height={352} />
      <div className="sp-more">
        <button onClick={() => os.openUrl(links.youtube)}>
          <b>fairytale</b>
          <span>music video · YouTube</span>
        </button>
        <button onClick={() => os.open('soundcloud')}>
          <b>kelix</b>
          <span>more on SoundCloud</span>
        </button>
      </div>
    </div>
  );
}
