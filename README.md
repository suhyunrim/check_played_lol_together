# check_played_lol_together
닉네임 리스트가 있으면 언제 서로 같이 마지막으로 게임 했는지 출력해주는 스크립트

### TODO
- [x] 실행 인자로 날짜 넘길 수 있게
- [x] 날짜 넘겼을 때 현재 날짜랑 터무니 없이 차이 많이 나면 예외 처리 필요 (V1은 라이엇에서 딱히 제재를 안하는 거 같은데 걱정 됨)
- [x] 실수로 없는 닉네임 넘기면 어케 되는지? 확인 및 예외 처리 필요
- [X] 적팀으로 만난 경우도 같이 게임 한 걸로 처리 됨. 예외 처리 필요
- [x] id_token 같은 값은 .env 로 빼기
- [x] 결과 리스트 csv 로 익스포팅 하기