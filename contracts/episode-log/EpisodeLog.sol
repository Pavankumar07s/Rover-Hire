// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Index of a rover's decision log on 0G Storage: one storage root per segment, in order.
contract EpisodeLog {
    struct Episode {
        address rover;
        uint32 segments;
        bool ended;
    }

    mapping(bytes32 => Episode) public episodes;

    event EpisodeStarted(bytes32 indexed episodeId, address indexed rover, string missionURI);
    event SegmentAnchored(bytes32 indexed episodeId, uint32 indexed segIndex, bytes32 root, uint64 firstSeq, uint64 lastSeq);
    event EpisodeEnded(bytes32 indexed episodeId, bytes32 finalRoot, uint32 safeStops, uint64 decisions);

    error Exists();
    error NotRover();
    error AlreadyEnded();
    error BadIndex();

    function startEpisode(bytes32 episodeId, string calldata missionURI) external {
        if (episodes[episodeId].rover != address(0)) revert Exists();
        episodes[episodeId] = Episode(msg.sender, 0, false);
        emit EpisodeStarted(episodeId, msg.sender, missionURI);
    }

    function anchorSegment(bytes32 episodeId, uint32 segIndex, bytes32 root, uint64 firstSeq, uint64 lastSeq) external {
        Episode storage e = _own(episodeId);
        if (segIndex != e.segments) revert BadIndex();
        e.segments = segIndex + 1;
        emit SegmentAnchored(episodeId, segIndex, root, firstSeq, lastSeq);
    }

    function endEpisode(bytes32 episodeId, bytes32 finalRoot, uint32 safeStops, uint64 decisions) external {
        Episode storage e = _own(episodeId);
        e.ended = true;
        emit EpisodeEnded(episodeId, finalRoot, safeStops, decisions);
    }

    /// Only the address that started an episode may write to it, and only until it ends.
    function _own(bytes32 episodeId) private view returns (Episode storage e) {
        e = episodes[episodeId];
        if (e.rover != msg.sender) revert NotRover();
        if (e.ended) revert AlreadyEnded();
    }
}
// 2026-11-06T07:00:00
// 2026-11-06T22:45:30
