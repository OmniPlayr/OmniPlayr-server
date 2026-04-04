import './styles/Player.css';
import { Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { DynamicIcon } from 'lucide-react/dynamic';

function Player() {
    return (
        <>
            <div className="player">
                <div className="player-song-info">
                    
                </div>
                <div className="player-controls">
                    <div className="player-control-options">
                        <Shuffle className="control-option-icon" id="shuffle" />
                        <SkipBack className="control-option-icon" id="prev" />
                        <div className="control-option-icon play-option" id="play-pause">
                            <DynamicIcon name="play" className="play-icon" />
                        </div>
                        <SkipForward className="control-option-icon" id="next" />
                        <DynamicIcon name="repeat" className="control-option-icon" id="repeat" />
                    </div>
                    <div className="player-progress-bar">
                        <span className="progress-time" id="current">0:00</span>
                        <div className="progress-bar">
                            <div className="progress-bar-fill"></div>
                        </div>
                        <span className="progress-time" id="duration">0:00</span>
                    </div>
                </div>
                <div className="player-options">

                </div>
            </div>
        </>
    )
}

export default Player