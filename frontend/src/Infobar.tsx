import { useEffect, useRef, useState } from 'react';
import { player, type TrackMetadata } from './modules/player';
import './styles/Infobar.css';
import { Music } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getInfoBars, onPluginsLoaded, on, type Infobar } from './modules/plugins';

type Layer = {
    id: number;
    src: string | null;
    leaving: boolean;
};

function AlbumLayer({
    src,
    leaving,
    onDone,
}: {
    src: string | null;
    leaving: boolean;
    onDone: () => void;
}) {
    const [valid, setValid] = useState(true);

    useEffect(() => {
        setValid(true);
    }, [src]);

    useEffect(() => {
        if (!leaving) return;
        const timer = setTimeout(onDone, 350);
        return () => clearTimeout(timer);
    }, [leaving]);

    const stateClass = leaving ? 'ib-art-out' : 'ib-art-in';

    if (!src || !valid) {
        return (
            <div className={`ib-art ib-art-placeholder ${stateClass}`}>
                <Music className="ib-art-placeholder-icon" />
            </div>
        );
    }

    return (
        <img
            className={`ib-art ${stateClass}`}
            src={src}
            alt="Album art"
            draggable={false}
            crossOrigin="anonymous"
            onError={() => {
                setValid(false);
            }}
        />
    );
}

function AlbumArt({
    metadata,
}: {
    metadata: TrackMetadata | {} | null;
}) {
    const src = (metadata as TrackMetadata)?.album_art ?? null;
    const counter = useRef(1);
    const [layers, setLayers] = useState<Layer[]>([
        { id: 0, src, leaving: false },
    ]);

    useEffect(() => {
        setLayers((prev) => {
            const active = prev.find((l) => !l.leaving);
            if (active && active.src === src) return prev;
            return [
                ...prev.map((l) => ({ ...l, leaving: true })),
                { id: counter.current++, src, leaving: false },
            ];
        });
    }, [src]);

    const remove = (id: number) => {
        setLayers((prev) => prev.filter((l) => l.id !== id));
    };

    return (
        <div className="ib-art-wrap">
            {layers.map((layer) => (
                <AlbumLayer
                    key={layer.id}
                    src={layer.src}
                    leaving={layer.leaving}
                    onDone={() => remove(layer.id)}
                />
            ))}
        </div>
    );
}

function Infobar() {
    const [metadata, setMetadata] = useState<TrackMetadata | null>(null);
    const { t } = useTranslation();
    const [openedInfobar, setOpenedInfobar] = useState<{ id: string; barId: string } | null>(() => {
        return JSON.parse(localStorage.getItem('infobar:opened') || 'null');
    });
    useEffect(() => {
        return on('infobar:updated', setOpenedInfobar);
    }, []);
    const [infoBars, setinfoBars] = useState<Infobar[]>([]);
    
    useEffect(() => {
        setinfoBars(getInfoBars());
        const unsub = onPluginsLoaded(() => setinfoBars(getInfoBars()));
        return unsub;
    }, []);

    useEffect(() => {
            return player.subscribe(() => {
                setMetadata(player.currentMetadata);
            });
        }, []);
    return (
        <>
            <div className="info-bar-container">
                <div className="info-bar" data-component="Infobar">
                    <div className="ib-song">
                        <AlbumArt metadata={metadata} />
                        <div className="ib-song-info">
                            {metadata ? (
                            <>
                                {metadata?.title ? (
                                    <span className="ib-song-title">{metadata.title}</span>
                                ) : (
                                    <span className="ib-song-title">{metadata?.filename}</span>
                                )}
                                <span className="ib-song-artist">{[metadata?.artist, metadata?.album].filter(Boolean).join(' · ')}</span>
                            </>
                            ) : (
                            <>
                                <span className="ib-song-title ib-song-nothing-playing">{t('info-bar.nothing-playing')}</span>
                            </>
                            )}
                        </div>
                    </div>
                    <div className="ib-song-more-info">

                    </div>
                </div>

                <div className="info-bar-overlay-container">
                    {infoBars.map(({ id, barId, view: View }) => (
                        <div
                            className={`info-bar-overlay${openedInfobar?.id === id && openedInfobar?.barId === barId ? ' open' : ''}`}
                            key={`${id}:${barId}`}
                        >
                            <View />
                        </div>
                    ))}
                </div>
            </div>
        </>
    )
}

export default Infobar