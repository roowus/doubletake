package com.roowus.doubletake;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Shares parked while offline: make sure the drain job is scheduled whenever the app opens.
        ShareQueue.INSTANCE.kick(this);
    }
}
