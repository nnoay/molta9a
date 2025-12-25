// =============================================
// VOTING SYSTEM - COMPLETELY FIXED
// =============================================
async function handleVote(playerId) {
    // Prevent multiple vote attempts
    if (isVoting) {
        showMessage('Please wait, processing your vote...', 'info');
        return;
    }
    
    if (userVoted) {
        showMessage('You have already voted from this device!', 'error');
        return;
    }

    // Disable all vote buttons immediately
    isVoting = true;
    disableAllVoteButtons();
    
    // Show loading state
    const voteBtn = document.querySelector(`.vote-btn[data-player="${playerId}"]`);
    if (voteBtn) {
        voteBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';
        voteBtn.disabled = true;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/vote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                playerId: playerId,
                deviceId: userDeviceId
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Vote successful - update local state
            userVoted = true;
            userVotedFor = playerId;
            
            // Update UI immediately
            updateVoteStatusUI();
            document.getElementById('resetVoteBtn').classList.remove('hidden');
            
            // Reload all data from server to get accurate counts
            await loadPlayers();
            
            showMessage(`You voted for ${getPlayerName(playerId)}!`, 'success');
            
        } else if (data.alreadyVoted) {
            // Server says we already voted - update local state
            userVoted = true;
            userVotedFor = data.playerId || playerId;
            
            // Check server state to confirm
            await checkDeviceVote();
            
            showMessage('You have already voted from this device!', 'error');
            
        } else {
            // Other error
            showMessage(data.error || 'Failed to vote. Please try again.', 'error');
            // Re-enable buttons
            enableAllVoteButtons();
            isVoting = false;
        }
        
    } catch (error) {
        console.error('Vote error:', error);
        showMessage('Network error. Please check your connection and try again.', 'error');
        // Re-enable buttons on error
        enableAllVoteButtons();
        isVoting = false;
        
        // Check if we actually voted by querying server
        setTimeout(async () => {
            await checkDeviceVote();
        }, 1000);
    }
}

// Also update the checkDeviceVote function to be more robust:
async function checkDeviceVote() {
    try {
        const response = await fetch(`${API_BASE_URL}/check-vote/${userDeviceId}`);
        if (!response.ok) return;
        
        const data = await response.json();
        if (data.hasVoted) {
            userVoted = true;
            userVotedFor = data.playerId;
            updateVoteStatusUI();
            document.getElementById('resetVoteBtn').classList.remove('hidden');
            disableAllVoteButtons();
            
            // Update vote count display for the voted player
            const player = players.find(p => p.id === parseInt(userVotedFor));
            if (player) {
                showMessage(`You voted for ${player.name}`, 'info');
            }
        } else {
            userVoted = false;
            userVotedFor = null;
            document.getElementById('voteStatusText').textContent = 'Ready to Vote';
            document.getElementById('resetVoteBtn').classList.add('hidden');
        }
    } catch (error) {
        console.error('Error checking vote:', error);
    }
}
