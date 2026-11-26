#!/usr/bin/env node
import { runHook, handleAgentPost } from '../src/core/hooks.js';
runHook(handleAgentPost);
