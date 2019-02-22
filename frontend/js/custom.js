const api_url = "http://localhost:8081";

const example_log =
  `ho
hi
ha`;

const example_filter =
  `filter {
  mutate {
    add_field => { "my_field" => "my-value" }
  }
}`;

function enableBlackTheme() {
  $('#css_theme').attr('href','./css/bootstrap-black.min.css');
  console.log("enable black theme")
}

function enableWhiteTheme() {
  $('#css_theme').attr('href','./css/bootstrap.min.css');
  console.log("enable white theme")

}

function jobFailed(reason, data) {
  alert("reason")
  disableWaitSpinner()
}

$('#fill_form').click(function () {
  $('#input_data_textarea').val(example_log);
  $('#logstash_filter_textarea').val(example_filter);

});

function disableWaitSpinner() {
  $('#wait_spinner').hide();
}

function userInputValid() {
  input_valid = true;

  var input_data = $('#input_data_textarea').val();
  var logstash_filter = $('#logstash_filter_textarea').val();

  if (input_data.length == 0) {
    $('#input_data_textarea').addClass("is-invalid");
    input_valid = false;
  } else {
    $('#input_data_textarea').removeClass("is-invalid");
  }

  if (logstash_filter.length == 0) {
    $('#logstash_filter_textarea').addClass("is-invalid");
    input_valid = false;
  } else {
    $('#logstash_filter_textarea').removeClass("is-invalid");
  }

  return input_valid
}

$('#start_process').click(function () {

  if (userInputValid()) {

    var body = {
      input_data: $('#input_data_textarea').val(),
      logstash_filter: $('#logstash_filter_textarea').val()
    };

    $('#wait_spinner').show();

    $.ajax({
      url: api_url + "/start_process",
      type: "POST",
      data: JSON.stringify(body),
      contentType: "application/json",
      dataType: "json",
      timeout: 60000,
      success: function (data) {
        if (!data.succeed) {
          jobFailed("Problem with your request", data)
        } else {
          $('#output').val(data.job_result.stdout);
          disableWaitSpinner()
        }
      },
      error: function () {
        jobFailed("Unable to obtain a response from the server")
      }
    });

  }

});


// Change theme button

$('#change_theme').click(function (){
  if($('#css_theme').attr('href').includes('bootstrap.min.css')) {
    enableBlackTheme()
  } else {
    enableWhiteTheme()
  }
});