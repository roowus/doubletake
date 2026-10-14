package com.roowus.doubletake;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Shares parked while offline or signed out: make sure the drain job is scheduled
        // whenever the app opens. The worker re-reads the session itself (it runs on its own
        // thread and outlives this activity), so a queue of hosted shares is delivered.
        ShareQueue.INSTANCE.kick(this);
    }
}
